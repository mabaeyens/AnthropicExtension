define(['qlik', 'jquery', './config'], function (qlik, $, config) {
  'use strict';

  // Native chart types we steer the AI toward. Used only to build the prompt —
  // parsing no longer rejects unlisted types; rendering decides what's possible.
  var SUGGESTED_TYPES = [
    'barchart', 'linechart', 'combochart', 'piechart', 'scatterplot',
    'table', 'pivot-table', 'kpi', 'histogram', 'distributionplot',
    'boxplot', 'waterfallchart', 'treemap', 'gauge', 'mekkochart', 'bulletchart'
  ];

  // Types we can't render here (geo data needs a different flow — deferred).
  var EXCLUDED_TYPES = ['map'];

  // Default size (grid units) and "packed" cutoff for sheet placement. Tunable;
  // grid width is read from the sheet at runtime, not hard-coded.
  var NEW_H = 8;
  var PACK_LIMIT = 24;

  // Counter for unique preview container ids (Date.now/Math.random avoided).
  var previewSeq = 0;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return {

    SUGGESTED_TYPES: SUGGESTED_TYPES,
    EXCLUDED_TYPES: EXCLUDED_TYPES,
    _escape: escapeHtml,

    /**
     * Instruction appended to a "suggest a chart" request. Steers the model to
     * reply with a single fenced ```qlik-chart JSON block using real fields.
     */
    buildPromptSuffix: function () {
      return '\n\nBased on the data and conversation above, propose ONE Qlik Sense ' +
        'chart that best visualizes the insight. Reply with ONLY a fenced code block ' +
        'tagged `qlik-chart` containing a JSON object with this exact shape:\n' +
        '```qlik-chart\n' +
        '{\n' +
        '  "type": "barchart",\n' +
        '  "title": "Short chart title",\n' +
        '  "dimensions": ["[Field Name]"],\n' +
        '  "measures": ["=Sum([Sales])"]\n' +
        '}\n' +
        '```\n' +
        'Rules: prefer one of these types — ' + SUGGESTED_TYPES.join(', ') + '. ' +
        'Do NOT use map charts. Use ONLY field names and master items that exist in ' +
        'the app context; wrap field names with spaces in [brackets]. Measures must be ' +
        'valid Qlik expressions starting with "=". For a histogram, supply a single ' +
        'numeric dimension and no measure. Output nothing except the code block.';
    },

    /**
     * Extract and parse a chart spec from an LLM response. Validates STRUCTURE
     * only (valid JSON + type + at least one dim/measure) — renderability is
     * decided later by renderPreview.
     * @returns {object|null}
     */
    parseChartSpec: function (text) {
      if (!text || typeof text !== 'string') return null;

      var json = null;
      var fenced = text.match(/```(?:qlik-chart|json)?\s*([\s\S]*?)```/i);
      if (fenced && fenced[1]) {
        json = fenced[1].trim();
      } else {
        var bare = text.match(/\{[\s\S]*"type"[\s\S]*\}/);
        if (bare) json = bare[0];
      }
      if (!json) return null;

      var spec;
      try {
        spec = JSON.parse(json);
      } catch (e) {
        return null;
      }
      if (!spec || typeof spec !== 'object') return null;

      var type = String(spec.type || '').toLowerCase().trim();
      if (!type) return null;

      var dims = Array.isArray(spec.dimensions) ? spec.dimensions.filter(Boolean) : [];
      var meas = Array.isArray(spec.measures) ? spec.measures.filter(Boolean) : [];
      if (dims.length === 0 && meas.length === 0) return null;

      return {
        type: type,
        title: spec.title ? String(spec.title) : 'Suggested chart',
        dimensions: dims.map(String),
        measures: meas.map(String)
      };
    },

    /**
     * Columns array for visualization.create. Histogram takes a single
     * dimension and computes frequency itself, so measures are dropped.
     */
    columnsFor: function (spec) {
      if (spec.type === 'histogram') {
        return (spec.dimensions || []).slice(0, 1);
      }
      return (spec.dimensions || []).concat(spec.measures || []);
    },

    /**
     * Render a live preview of a chart spec into $mountEl using the current
     * app's in-session visualization API (runs as the logged-in user).
     * @param {object} spec
     * @param {jQuery} $mountEl
     * @param {function} [onAddToSheet] called with (spec, $card) when the user
     *        clicks "Add to sheet".
     * @returns {Promise} resolves with the viz handle, rejects with an Error.
     */
    renderPreview: function (spec, $mountEl, onAddToSheet) {
      var self = this;
      return new Promise(function (resolve, reject) {
        if (!spec) { reject(new Error('No chart specification.')); return; }
        if (EXCLUDED_TYPES.indexOf(spec.type) !== -1) {
          reject(new Error('Chart type not supported here: ' + spec.type));
          return;
        }

        var app;
        try { app = qlik.currApp(); } catch (e) {
          reject(new Error('No active Qlik app in this session.')); return;
        }
        if (!app || !app.visualization || !app.visualization.create) {
          reject(new Error('Qlik visualization API is unavailable.')); return;
        }

        previewSeq += 1;
        var divId = 'anthropic-chart-preview-' + previewSeq;
        var columns = self.columnsFor(spec);

        var $card = $('<div class="anthropic-chart-card"></div>');
        var $head = $('<div class="anthropic-chart-card-head"></div>')
          .append($('<span class="anthropic-chart-card-title"></span>').text(spec.title));
        var $remove = $('<button type="button" class="anthropic-chart-remove" title="Remove preview">Remove</button>');
        $head.append($remove);
        var $host = $('<div class="anthropic-chart-host"></div>').attr('id', divId);
        var $spec = $('<details class="anthropic-chart-spec"><summary>Chart spec</summary></details>')
          .append($('<pre></pre>').text(JSON.stringify(spec, null, 2)));
        var $actions = $('<div class="anthropic-chart-actions"></div>');
        var $add = $('<button type="button" class="lui-button anthropic-chart-add">Add to sheet</button>');
        $actions.append($add);

        $card.append($head).append($host).append($actions).append($spec);
        $mountEl.append($card);

        $add.on('click', function () {
          if (typeof onAddToSheet === 'function') onAddToSheet(spec, $card);
        });

        app.visualization.create(spec.type, columns, { title: spec.title })
          .then(function (viz) {
            viz.show(divId);
            $remove.on('click', function () {
              try { viz.close(); } catch (e) { /* ignore */ }
              $card.remove();
            });
            resolve(viz);
          })
          .catch(function (err) {
            var msg = (err && err.message) ? err.message : String(err);
            $host.html('<div class="anthropic-chart-error">Could not render chart: ' +
              escapeHtml(msg) + '</div>');
            reject(err instanceof Error ? err : new Error(msg));
          });
      });
    },

    // ── Sheet placement ──────────────────────────────────────────────────────

    /** Current app interaction mode ('analysis' | 'edit' | …) or '' if unknown. */
    getMode: function () {
      try {
        if (qlik.navigation && qlik.navigation.getMode) {
          return qlik.navigation.getMode() || '';
        }
      } catch (e) { /* ignore */ }
      return '';
    },

    isEditMode: function () {
      return this.getMode() === 'edit';
    },

    /** Best-effort current sheet id. */
    getCurrentSheetId: function () {
      try {
        if (qlik.navigation && qlik.navigation.getCurrentSheetId) {
          var r = qlik.navigation.getCurrentSheetId();
          // Some versions return a string, others { sheetId }.
          if (r && typeof r === 'object') return r.sheetId || r.id || null;
          if (typeof r === 'string') return r;
        }
      } catch (e) { /* ignore */ }
      return null;
    },

    /** Compute grid width and used height from a sheet's cells. */
    _layoutOf: function (cells) {
      var gridW = 24, usedRows = 0;
      (cells || []).forEach(function (c) {
        var colEdge = (c.col || 0) + (c.colspan || 0);
        var rowEdge = (c.row || 0) + (c.rowspan || 0);
        if (colEdge > gridW) gridW = colEdge;
        if (rowEdge > usedRows) usedRows = rowEdge;
      });
      return { gridW: gridW, usedRows: usedRows };
    },

    /** Build a valid chart property tree for `spec` via a temp session viz. */
    _buildChartProps: function (app, spec) {
      var self = this;
      return app.visualization.create(spec.type, self.columnsFor(spec), { title: spec.title })
        .then(function (viz) {
          return viz.model.getProperties().then(function (props) {
            try { viz.close(); } catch (e) { /* ignore */ }
            // Let the engine assign a fresh id when added to the sheet.
            if (props && props.qInfo) delete props.qInfo.qId;
            return props;
          });
        });
    },

    /**
     * Add the chart to the current sheet. Requires Edit mode. Places a
     * full-width band below existing objects; if the sheet is packed, returns
     * { packed: true } without modifying anything.
     * @returns {Promise<object>} { added } | { packed } | throws Error
     */
    addToSheet: function (spec) {
      var self = this;
      if (!this.isEditMode()) {
        return Promise.reject(new Error('NOT_EDIT_MODE'));
      }
      var app;
      try { app = qlik.currApp(); } catch (e) {
        return Promise.reject(new Error('No active Qlik app.'));
      }
      var enigma = app.model && app.model.enigmaModel;
      if (!enigma || !enigma.getObject) {
        return Promise.reject(new Error('Engine handle unavailable.'));
      }
      var sheetId = this.getCurrentSheetId();
      if (!sheetId) return Promise.reject(new Error('Could not determine the current sheet.'));

      var sheet, props, geom;
      return enigma.getObject(sheetId).then(function (s) {
        sheet = s;
        return sheet.getProperties();
      }).then(function (p) {
        props = p || {};
        props.cells = props.cells || [];
        var lay = self._layoutOf(props.cells);
        geom = { col: 0, row: lay.usedRows, colspan: lay.gridW, rowspan: NEW_H };
        if (lay.usedRows + NEW_H > PACK_LIMIT) {
          return { packed: true };
        }
        return self._buildChartProps(app, spec).then(function (chartProps) {
          return sheet.createChild(chartProps).then(function (child) {
            return child.getLayout().then(function (lo) {
              props.cells.push({
                name: lo.qInfo.qId, type: spec.type,
                col: geom.col, row: geom.row, colspan: geom.colspan, rowspan: geom.rowspan
              });
              return sheet.setProperties(props).then(function () {
                return app.doSave().then(function () {
                  return { added: true, sheetId: sheetId };
                });
              });
            });
          });
        });
      });
    },

    /**
     * Create a new sheet containing the chart and navigate to it. Used on the
     * "packed" path. Requires Edit mode.
     * @returns {Promise<object>} { created, sheetId } | throws Error
     */
    createSheetWithChart: function (spec) {
      var self = this;
      if (!this.isEditMode()) {
        return Promise.reject(new Error('NOT_EDIT_MODE'));
      }
      var app;
      try { app = qlik.currApp(); } catch (e) {
        return Promise.reject(new Error('No active Qlik app.'));
      }
      var enigma = app.model && app.model.enigmaModel;
      if (!enigma || !enigma.createObject) {
        return Promise.reject(new Error('Engine handle unavailable.'));
      }

      var newSheet, newSheetId;
      var sheetProps = {
        qInfo: { qType: 'sheet' },
        qMetaDef: { title: spec.title || 'AI charts' },
        rank: 0,
        thumbnail: { qStaticContentUrlDef: {} },
        columns: 24,
        rows: 12,
        cells: [],
        qChildListDef: { qData: { title: '/title' } }
      };

      return enigma.createObject(sheetProps).then(function (s) {
        newSheet = s;
        return newSheet.getLayout();
      }).then(function (lo) {
        newSheetId = lo.qInfo.qId;
        return self._buildChartProps(app, spec);
      }).then(function (chartProps) {
        return newSheet.createChild(chartProps);
      }).then(function (child) {
        return child.getLayout();
      }).then(function (lo) {
        return newSheet.getProperties().then(function (p) {
          p.cells = p.cells || [];
          p.cells.push({
            name: lo.qInfo.qId, type: spec.type,
            col: 0, row: 0, colspan: 24, rowspan: NEW_H
          });
          return newSheet.setProperties(p);
        });
      }).then(function () {
        return app.doSave();
      }).then(function () {
        try {
          if (qlik.navigation && qlik.navigation.gotoSheet) qlik.navigation.gotoSheet(newSheetId);
        } catch (e) { /* ignore */ }
        return { created: true, sheetId: newSheetId };
      });
    }
  };
});
