define(['qlik', 'jquery', './config'], function(qlik, $, config) {
  'use strict';

  // Module variables
  let currentApp = null;
  let extensionId = null;
  let selectionCallback = null;
  let selectionHandler = null;
  let selectionStyleAdded = false;

  return {
    /**
     * Initialize the data collector with the current app and extension ID
     * @param {object} app - The Qlik app
     * @param {string} id - The extension ID
     */
    init: function(app, id) {
      currentApp = app;
      extensionId = id;
      console.log("[DEBUG] Data collector initialized with app:", app.id);
    },

    /**
     * Start tracking visualization selections
     * @param {function} callback - Function to call when a visualization is selected
     */
    startSelectionTracking: function(callback) {
      console.log("[DEBUG] Starting visualization selection tracking");

      // Store the callback
      selectionCallback = callback;

      // Add selection styles if not already added
      this.addSelectionStyles();

      // Remove any existing handler to avoid duplicates
      this.stopSelectionTracking();

      // Create a new handler function
      selectionHandler = function(e) {
        // Find the closest visualization object
        const $target = $(e.target);
        const $vizObject = $target.closest('.qv-object');
      
        // Skip if clicking on controls
        if ($target.closest('.lui-button, .lui-checkbox, .lui-select, .qv-state-count-bar').length) {
          return;
        }
      
        // Skip clicks on the container that holds our own extension object.
        if ($vizObject.find('#' + extensionId).length ||
            $vizObject.find('[data-object-id="' + extensionId + '"]').length) {
          console.log("[DEBUG] Ignoring click on container with extension");
          return;
        }

        // Gather every plausible object id near the click (short engine ids and
        // GUIDs, ordered by proximity) rather than guessing a single one. We then
        // let the Qlik engine decide which id actually resolves to a chart — so a
        // wrong token (e.g. the chart type, or the sheet id) is simply skipped.
        const candidates = this.collectCandidateIds($target, $vizObject);

        if (!candidates.length) {
          console.log("[DEBUG] No candidate object ids found near click");
          // Surface a copyable DOM dump so the id-bearing attribute can be
          // identified without another blind round-trip.
          if ($vizObject.length && selectionCallback) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            selectionCallback(null, null, { objectId: null, dom: this.describeDomChain($target) });
          }
          return;
        }

        console.log("[DEBUG] Candidate ids:", candidates.join(', '));

        // Prevent default behavior. stopImmediatePropagation is essential: this
        // handler runs in the capture phase (see addEventListener below), so
        // stopping propagation keeps the click from ever reaching Qlik's own chart
        // handlers, which would otherwise select values inside the chart.
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        this.getObjectDataFromCandidates(candidates).then(function(result) {
          if (selectionCallback) selectionCallback(result.id, result.data);
        }).catch(function(error) {
          console.error("[DEBUG] No candidate id resolved to a usable chart:", error);
          if (selectionCallback) {
            selectionCallback(null, null, {
              objectId: candidates[0],
              error: error,
              dom: this.describeDomChain($target)
            });
          }
        }.bind(this));
      }.bind(this);

      // Attach the handler in the CAPTURE phase (third arg = true) so it runs
      // before Qlik's descendant chart handlers — bubble-phase ($(document).on)
      // fired too late and the chart selected values instead.
      document.addEventListener('click', selectionHandler, true);

      console.log("[DEBUG] Selection tracking started");
    },

    /**
     * Stop tracking visualization selections
     */
    stopSelectionTracking: function() {
      console.log("[DEBUG] Stopping visualization selection tracking");

      // Remove the handler if it exists (must match the capture-phase flag)
      if (selectionHandler) {
        document.removeEventListener('click', selectionHandler, true);
        selectionHandler = null;
      }

      console.log("[DEBUG] Selection tracking stopped");
    },

    /**
     * Add styles for selection mode
     */
    addSelectionStyles: function() {
      if (selectionStyleAdded) return;

      // Add CSS for selection mode
      $('<style id="anthropic-selection-styles">')
        .html(`
          body.anthropic-selection-mode .qv-object {
            cursor: pointer !important;
            transition: all 0.2s ease;
          }

          body.anthropic-selection-mode .qv-object:hover {
            box-shadow: 0 0 8px 3px rgba(0, 120, 255, 0.5) !important;
            transform: scale(1.01);
          }

          #select-chart-button.selection-active {
            background-color: #ff9900;
            color: white;
          }

          .chart-selection-area {
            margin: 10px 0;
          }
        `)
        .appendTo('head');

      selectionStyleAdded = true;
      console.log("[DEBUG] Selection styles added");
    },

    /**
     * Extract the Qlik object id from a clicked element.
     * Order of preference:
     *   1. `tid` attribute on the nearest cell/object (reliable, Qlik-set)
     *   2. `data-qid` / `data-object-id` attributes
     *   3. the qv-object-<id> CSS class, skipping qv-object-<type> tokens
     * @param {jQuery} $target - the actual clicked element
     * @param {jQuery} $vizObject - the closest .qv-object container
     * @returns {string|null} the object id
     */
    extractObjectId: function ($target, $vizObject) {
      // Qlik object ids come in two shapes:
      //   • full GUID for newer objects (e.g. 7e74e87a-7ef8-4bf2-a142-b4cabb3dda2a)
      //   • short engine id for objects created in older apps (e.g. "AzPdbJd",
      //     "DAjgzV", "FpRLjYw") — mixed-case alphanumeric, no hyphens.
      var GUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
      var ID_LIKE = /^[A-Za-z0-9_-]{3,}$/;

      // Scan from the clicked element up to (and a few levels past) the .qv-object
      // container. Bounding the walk to the object's own cell keeps us from
      // grabbing the SHEET's or APP's GUID from a higher ancestor — a real risk
      // in older apps whose charts use short ids that don't carry their own GUID.
      var el = $target[0];
      var guidHit = null, namedHit = null;
      var sawObject = false, extra = 0, depth = 0;
      while (el && el !== document.body && depth < 15 && extra <= 3) {
        if (el.attributes) {
          // Prefer a GUID found in any attribute (covers new objects + bundle
          // vizzes like distributionplot whose .qv-object class has only the type).
          if (!guidHit) {
            for (var i = 0; i < el.attributes.length; i++) {
              var m = (el.attributes[i].value || '').match(GUID);
              if (m && m[0] !== extensionId) { guidHit = m[0]; break; }
            }
          }
          // Otherwise remember the first named id attribute — this is where short
          // engine ids live (tid on the cell, or data-qid/data-object-id).
          if (!namedHit) {
            var named = el.getAttribute('tid') ||
                        el.getAttribute('data-qid') ||
                        el.getAttribute('data-object-id');
            if (named && named !== extensionId && ID_LIKE.test(named)) namedHit = named;
          }
        }
        if (guidHit) break; // GUID is the strongest signal — stop early
        if ($vizObject[0] && el === $vizObject[0]) sawObject = true;
        if (sawObject) extra++;
        el = el.parentElement;
        depth++;
      }
      if (guidHit) return guidHit;
      if (namedHit) return namedHit;

      // Class fallback on .qv-object: a GUID, else a qv-object-<token> that looks
      // like an engine id. Chart TYPE tokens (barchart/kpi/table/distributionplot)
      // are all-lowercase; engine ids contain an uppercase letter or a digit.
      var cls = ($vizObject.attr('class') || '');
      var g = cls.match(GUID);
      if (g && g[0] !== extensionId) return g[0];
      var tokens = (cls.match(/qv-object-([a-zA-Z0-9_-]+)/g) || [])
        .map(function (t) { return t.replace('qv-object-', ''); })
        .filter(function (t) { return t !== extensionId && /[A-Z0-9]/.test(t); });
      return tokens[0] || null;
    },

    /**
     * Collect every plausible Qlik object id near a clicked element, ordered by
     * proximity (closest first) so the clicked object's own id precedes any
     * sheet/app id. Handles both full GUIDs and short engine ids (e.g. "YMLQpv").
     * @param {jQuery} $target - the actual clicked element
     * @param {jQuery} $vizObject - the closest .qv-object container
     * @returns {string[]} ordered, de-duplicated candidate ids
     */
    collectCandidateIds: function ($target, $vizObject) {
      var GUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
      var ID_LIKE = /^[A-Za-z0-9_-]{3,}$/;
      var out = [];
      function add(v) {
        if (v && v !== extensionId && out.indexOf(v) === -1) out.push(v);
      }

      // Walk from the click up; named id attributes first, then any GUID-valued
      // attribute. Proximity ordering keeps the object's own id ahead of the
      // sheet/app id that may sit on a higher ancestor.
      var el = $target[0];
      var depth = 0;
      while (el && el !== document.body && depth < 20) {
        if (el.getAttribute) {
          var named = [el.getAttribute('tid'), el.getAttribute('data-qid'), el.getAttribute('data-object-id')];
          for (var n = 0; n < named.length; n++) {
            if (named[n] && ID_LIKE.test(named[n])) add(named[n]);
          }
        }
        if (el.attributes) {
          for (var i = 0; i < el.attributes.length; i++) {
            var m = (el.attributes[i].value || '').match(GUID);
            if (m) add(m[0]);
          }
        }
        el = el.parentElement;
        depth++;
      }

      // Class on .qv-object: a GUID, then qv-object-<token> ids. Chart TYPE tokens
      // (barchart/linechart/boxplot/combochart…) are all-lowercase and skipped;
      // engine ids contain an uppercase letter or a digit.
      var cls = ($vizObject.attr('class') || '');
      var g = cls.match(GUID);
      if (g) add(g[0]);
      (cls.match(/qv-object-([a-zA-Z0-9_-]+)/g) || [])
        .map(function (t) { return t.replace('qv-object-', ''); })
        .filter(function (t) { return /[A-Z0-9]/.test(t); })
        .forEach(add);

      return out;
    },

    /**
     * True when chart data looks usable (real chart), so a wrong candidate id
     * resolving to a sheet / non-chart object is skipped during try-each.
     * @param {object} d - chart data from getObjectData
     * @returns {boolean}
     */
    isUsableChartData: function (d) {
      if (!d || d.error) return false;
      if ((d.dimensions && d.dimensions.length) || (d.measures && d.measures.length)) return true;
      if (d.data && d.data.length) {
        // reject the getObjectFallback "Unable to retrieve…" sentinel
        if (d.data.length === 1 && typeof d.data[0] === 'string' && /unable to retrieve/i.test(d.data[0])) {
          return false;
        }
        return true;
      }
      return false;
    },

    /**
     * Try each candidate id in order; resolve with the first that yields usable
     * chart data. Lets the engine validate which id is the real clicked object.
     * @param {string[]} ids - ordered candidate ids
     * @returns {Promise<{id:string, data:object}>}
     */
    getObjectDataFromCandidates: function (ids) {
      var self = this;
      return new Promise(function (resolve, reject) {
        var idx = 0;
        var lastErr = null;
        function tryNext() {
          if (idx >= ids.length) {
            reject(lastErr || new Error('No candidate id resolved to a chart'));
            return;
          }
          var id = ids[idx++];
          self.getObjectData(id).then(function (data) {
            if (self.isUsableChartData(data)) {
              resolve({ id: id, data: data });
            } else {
              tryNext();
            }
          }).catch(function (err) {
            lastErr = err;
            tryNext();
          });
        }
        tryNext();
      });
    },

    /**
     * Build a copyable dump of the clicked element's ancestor chain (up to the
     * .qv-object container) — used as a diagnostic when extractObjectId fails so
     * the exact id-bearing attribute can be identified without guesswork.
     * @param {jQuery} $target - the actual clicked element
     * @returns {string} a human-readable ancestor/attribute dump
     */
    describeDomChain: function ($target) {
      var lines = [];
      var el = $target[0];
      var depth = 0;
      while (el && el !== document.body && depth < 12) {
        var attrs = [];
        if (el.attributes) {
          for (var i = 0; i < el.attributes.length; i++) {
            attrs.push(el.attributes[i].name + '="' + el.attributes[i].value + '"');
          }
        }
        lines.push('<' + (el.tagName || '?').toLowerCase() + ' ' + attrs.join(' ') + '>');
        if (el.classList && el.classList.contains('qv-object')) break;
        el = el.parentElement;
        depth++;
      }
      return lines.join('\n');
    },

    /**
    * Get data for a specific object
    * @param {string} objectId - The ID of the object
    * @returns {Promise} Promise resolving to the object data
    */
    getObjectData: function (objectId) {
      console.log("[DEBUG] Getting data for object:", objectId);

      return new Promise(function (resolve, reject) {
        // Make sure we have a current app
        if (!currentApp) {
          currentApp = qlik.currApp();
        }
        
        // Add debug information about the object
        console.log("[DEBUG] Getting object:", objectId, "in app:", currentApp.id);
        
        // Get the object properties first to determine its type
        currentApp.getObjectProperties(objectId).then(function(props) {
          console.log("[DEBUG] Object properties:", 
                    `Type: ${props.qInfo?.qType || "Unknown"}, ` +
                    `Properties: ${Object.keys(props).join(", ")}`);
        }).catch(function(err) {
          console.log("[DEBUG] Could not get object properties:", err);
        });

        // First, get the current selections
        this.getCurrentSelections().then(selections => {
          console.log("[DEBUG] Got current selections");

          // Try to get the object using the visualization API first
          currentApp.visualization.get(objectId).then(function (vis) {
            console.log("[DEBUG] Got visualization object");

            // Get the layout
            vis.model.getLayout().then(function (layout) {
              console.log("[DEBUG] Got layout for visualization");

              // Process the layout
              const chartData = this.processVisualizationLayout(objectId, layout);

              // Add the current selections
              chartData.currentSelections = selections;

              // Check if we need to fetch more data (for tables)
              if (chartData.needsDataFetch) {
                console.log("[DEBUG] Need to fetch additional table data");

                // Fetch the complete table data
                this.fetchTableData(objectId, chartData).then(function (completeData) {
                  // Optimize the data before returning it - get maxRows from config
                  // We don't have UI settings here, so use a higher default to preserve more data
                  const optimizedData = this.optimizeDataForTokens(completeData, {
                    maxRows: 100000 // Recover the full hypercube; the 65 KB warning guards oversized sends
                  });
                  resolve(optimizedData);
                }.bind(this)).catch(function (error) {
                  console.error("[DEBUG] Error fetching table data:", error);
                  // Optimize what we have - use high limits
                  const optimizedData = this.optimizeDataForTokens(chartData, {
                    maxRows: 100000 // Recover the full hypercube; the 65 KB warning guards oversized sends
                  });
                  resolve(optimizedData); // Return what we have
                }.bind(this));
              } else {
                // No need to fetch more data, optimize and return
                const optimizedData = this.optimizeDataForTokens(chartData, {
                  maxRows: 100000 // Recover the full hypercube; the 65 KB warning guards oversized sends
                });
                resolve(optimizedData);
              }
            }.bind(this)).catch(function (error) {
              console.error("[DEBUG] Error getting visualization layout:", error);

              // Try fallback method
              this.getObjectFallback(objectId).then(chartData => {
                // Add the current selections
                chartData.currentSelections = selections;
                resolve(chartData);
              }).catch(reject);
            }.bind(this));
          }.bind(this)).catch(function (error) {
            console.error("[DEBUG] Error getting visualization:", error);

            // Try fallback method
            this.getObjectFallback(objectId).then(chartData => {
              // Add the current selections
              chartData.currentSelections = selections;
              resolve(chartData);
            }).catch(reject);
          }.bind(this));
        }).catch(function (error) {
          console.error("[DEBUG] Error getting current selections:", error);

          // Continue without selections
          this.getObjectFallback(objectId).then(resolve).catch(reject);
        }.bind(this));
      }.bind(this));
    },

    /**
    * Get current selections in the app
    * @returns {Promise} Promise resolving to an array of selections
    */
    getCurrentSelections: function () {
      console.log("[DEBUG] Getting current selections");

      if (!currentApp) {
        currentApp = qlik.currApp();
      }

      // Use a ONE-SHOT enigma session object instead of app.getList(): getList
      // creates a persistent, subscribed engine object that is never released, so
      // calling it on every chart selection leaked engine session objects. We
      // create, read once, and destroy.
      var doc = currentApp.model && currentApp.model.enigmaModel;
      if (!doc || !doc.createSessionObject) {
        return Promise.resolve([]);
      }

      var objId = null;
      return doc.createSessionObject({
        qInfo: { qType: 'anthropic-cursel' },
        qSelectionObjectDef: {}
      }).then(function (obj) {
        objId = obj.id;
        return obj.getLayout();
      }).then(function (layout) {
        var sels = (layout.qSelectionObject && layout.qSelectionObject.qSelections) || [];
        var selections = sels.map(function (s) {
          return { field: s.qField, values: s.qSelected, count: s.qSelectedCount };
        });
        if (objId && doc.destroySessionObject) {
          doc.destroySessionObject(objId).catch(function () {});
        }
        console.log("[DEBUG] Current selections:", selections.length);
        return selections;
      }).catch(function (err) {
        console.warn("[DEBUG] Could not read current selections:", err);
        if (objId && doc.destroySessionObject) {
          doc.destroySessionObject(objId).catch(function () {});
        }
        return [];
      });
    },
    
    /**
    * Fallback method to get object data
    * @param {string} objectId - The ID of the object
    * @returns {Promise} Promise resolving to the object data
    */
    getObjectFallback: function (objectId) {
      console.log("[DEBUG] Using fallback method for object:", objectId);

      return new Promise(function (resolve, reject) {
        // Try using getObject API
        currentApp.getObject(objectId).then(function (model) {
          console.log("[DEBUG] Got object model via fallback");

          model.getLayout().then(function (layout) {
            console.log("[DEBUG] Got layout via fallback");

            // Process the layout
            const chartData = this.processVisualizationLayout(objectId, layout);

            // Check if we need to fetch more data (for tables)
            if (chartData.needsDataFetch) {
              console.log("[DEBUG] Need to fetch additional table data (fallback)");

              // Fetch the complete table data
              this.fetchTableData(objectId, chartData).then(function (completeData) {
                // Optimize the data before returning it
                const optimizedData = this.optimizeDataForTokens(completeData, {
                  maxRows: 100000 // Recover the full hypercube; the 65 KB warning guards oversized sends
                });
                resolve(optimizedData);
              }.bind(this)).catch(function (error) {
                console.error("[DEBUG] Error fetching table data (fallback):", error);
                // Optimize what we have
                const optimizedData = this.optimizeDataForTokens(chartData, {
                  maxRows: 100000 // Recover the full hypercube; the 65 KB warning guards oversized sends
                });
                resolve(optimizedData); // Return what we have
              }.bind(this));
            } else {
              // No need to fetch more data, optimize and return
              const optimizedData = this.optimizeDataForTokens(chartData, {
                maxRows: 100000 // Recover the full hypercube; the 65 KB warning guards oversized sends
              });
              resolve(optimizedData);
            }
          }.bind(this)).catch(function (error) {
            console.error("[DEBUG] Error getting layout via fallback:", error);

            // Create basic data from DOM as last resort
            const $object = $('.qv-object-' + objectId);
            const title = $object.find('.qv-object-title').text() || "Unknown Chart";
            const type = $object.attr('class').match(/qv-object-([a-z]+)/) ?
              $object.attr('class').match(/qv-object-([a-z]+)/)[1] : "Unknown";

            const basicData = {
              info: {
                id: objectId,
                title: title,
                type: type
              },
              data: ["Unable to retrieve detailed data for this visualization"],
              currentSelections: [] // Empty selections for fallback
            };

            resolve(basicData);
          }.bind(this));
        }.bind(this)).catch(function (error) {
          console.error("[DEBUG] Complete fallback error:", error);
          reject(error);
        });
      }.bind(this));
    },

    /**
     * Process a visualization layout into a structured format
     * @param {string} objectId - The ID of the object
     * @param {object} layout - The layout object
     * @returns {object} Structured chart data
     */
    processVisualizationLayout: function(objectId, layout) {
      if (config.DEBUG_MODE) {
        console.log("[DEBUG] Processing visualization layout");
        
        // Add extra debug for special visualization types
        const visType = layout.visualization || layout.qInfo?.qType || "Unknown";
        console.log(`[DEBUG] Visualization type: ${visType}`);
        console.log(`[DEBUG] Layout properties: ${Object.keys(layout).join(", ")}`);
      }
      
      // Determine chart family for specialized handling
      const visType = layout.visualization || layout.qInfo?.qType || "Unknown";
      const isMap = visType.toLowerCase().includes('map');
      const isBar = visType.toLowerCase().includes('bar');
      const isLine = visType.toLowerCase().includes('line');
      const isCombo = visType.toLowerCase().includes('combo');
      const isSpecialChart = isMap || isBar || isLine || isCombo;
      
      // Basic info about the visualization
      const objectInfo = {
        id: objectId,
        title: layout.title || layout.qInfo?.qId || "Untitled Chart",
        type: visType
      };
    
      let chartData = {
        info: objectInfo,
        dimensions: [],
        measures: [],
        data: []
      };
    
      // Extract data from hypercube if available
      if (layout.qHyperCube) {
        if (config.DEBUG_MODE) {
          console.log("[DEBUG] Extracting hypercube data");
        }
    
        // Add chart type info
        chartData.chartType = visType;
        
        // Get chart specific properties if available
        if (isSpecialChart) {
          chartData.chartProperties = {};
          
          // Add chart-specific information
          if (isBar) {
            chartData.chartProperties.isStacked = layout.presentation?.stacked || false;
            chartData.chartProperties.isHorizontal = layout.presentation?.horizontal || false;
          }
          
          if (isLine) {
            chartData.chartProperties.hasSymbols = layout.presentation?.symbols || false;
            chartData.chartProperties.isCurved = layout.presentation?.curved || false;
          }
          
          if (isCombo) {
            chartData.chartProperties.isDimensionAxis = layout.presentation?.dimensionAxis || false;
            chartData.chartProperties.combinations = layout.presentation?.combinations || [];
          }
        }
    
        // Get dimensions
        chartData.dimensions = layout.qHyperCube.qDimensionInfo.map(dim => ({
          name: dim.qFallbackTitle,
          field: dim.qGroupFieldDefs ? dim.qGroupFieldDefs.join(', ') : ''
        }));
    
        // Get measures
        chartData.measures = layout.qHyperCube.qMeasureInfo.map(meas => ({
          name: meas.qFallbackTitle,
          formula: meas.qDef,
          format: meas.qNumFormat ? meas.qNumFormat.qFmt : ''
        }));
        
        // Add axis titles if available (common in charts)
        if (layout.xAxis && layout.xAxis.title) {
          chartData.xAxisTitle = layout.xAxis.title;
        }
        
        if (layout.yAxis && layout.yAxis.title) {
          chartData.yAxisTitle = layout.yAxis.title;
        }
    
        // Get data cells from existing data pages
        if (layout.qHyperCube.qDataPages && layout.qHyperCube.qDataPages.length > 0) {
          layout.qHyperCube.qDataPages.forEach(page => {
            if (page.qMatrix) {
              page.qMatrix.forEach(row => {
                const dataRow = row.map(cell => ({
                  value: cell.qText,
                  numValue: cell.qNum,
                  state: cell.qState
                }));
                chartData.data.push(dataRow);
              });
            }
          });
        }
        
        // Process stacked data pages (common in bar/combo charts)
        if (layout.qHyperCube.qStackedDataPages && layout.qHyperCube.qStackedDataPages.length > 0) {
          if (config.DEBUG_MODE) {
            console.log("[DEBUG] Processing stacked data pages");
          }
          
          // If we don't already have chartProperties, initialize it
          if (!chartData.chartProperties) {
            chartData.chartProperties = {};
          }
          
          // Mark this as having stacked data
          chartData.chartProperties.hasStackedData = true;
          chartData.stackedData = [];
          
          layout.qHyperCube.qStackedDataPages.forEach((stackedPage, pageIndex) => {
            if (stackedPage.qData && stackedPage.qData.length > 0) {
              stackedPage.qData.forEach((stackedRow, rowIndex) => {
                // Convert measure data to rows for easier analysis
                stackedRow.qSubNodes.forEach((measureNode, measureIndex) => {
                  const measureName = chartData.measures[measureIndex]?.name || `Measure ${measureIndex+1}`;
                  
                  // Dimension value from row header
                  const dimensionValue = stackedRow.qText || `Value ${rowIndex+1}`;
                  
                  // Create a row for each measure in each dimension
                  const dataRow = [
                    {value: dimensionValue, numValue: rowIndex, state: "D"}, // Dimension 
                    {value: measureName, numValue: measureIndex, state: "M"}, // Measure name
                    {value: measureNode.qText, numValue: measureNode.qValue, state: measureNode.qState} // Value
                  ];
                  
                  // Store in both main data and specialized stacked data
                  chartData.data.push(dataRow);
                  chartData.stackedData.push({
                    dimension: dimensionValue,
                    measure: measureName,
                    value: measureNode.qText,
                    numValue: measureNode.qValue,
                    state: measureNode.qState
                  });
                });
              });
            }
          });
        }
    
        // If the engine returned fewer rows than the hypercube holds (large
        // tables only ship an initial page), page through the FULL hypercube so
        // the LLM receives the complete result set. Skipped for stacked data,
        // whose row count intentionally differs from qSize.
        const hc = layout.qHyperCube;
        const isStacked = chartData.chartProperties && chartData.chartProperties.hasStackedData;
        if (!isStacked && hc.qSize && hc.qSize.qcx > 0 && hc.qSize.qcy > chartData.data.length) {
          if (config.DEBUG_MODE) {
            console.log("[DEBUG] Full fetch needed:", hc.qSize.qcx + "x" + hc.qSize.qcy,
                        "(initial page had " + chartData.data.length + " rows)");
          }
          chartData.needsDataFetch = true;
          chartData.hypercubeSize = hc.qSize;
          chartData.data = []; // reset so fetchTableData pulls the complete set from row 0
        }
      } else if (isMap) {
        // Handle map visualizations - they can have different data structures
        if (config.DEBUG_MODE) {
          console.log("[DEBUG] Map visualization - checking for map-specific data");
        }
        
        // Set map-specific properties 
        chartData.chartType = 'map';
        chartData.mapInfo = {
          type: visType,
          hasLayers: !!layout.qLayerData,
          hasMapData: !!layout.mapData,
          hasGeoData: false // Will be set to true if we find geo data
        };
        
        let hasExtractedData = false;
        
        // Map visualizations can have layer data
        if (layout.qLayerData) {
          if (config.DEBUG_MODE) {
            console.log("[DEBUG] Found qLayerData, extracting map data");
          }
          
          chartData.mapLayers = [];
          
          // Process each layer
          layout.qLayerData.forEach((layer, layerIndex) => {
            if (config.DEBUG_MODE) {
              console.log(`[DEBUG] Processing map layer ${layerIndex}, type: ${layer.type}`);
            }
            
            const layerInfo = {
              name: layer.qInfo?.qId || layer.cId || `Layer ${layerIndex + 1}`,
              type: layer.type || "Unknown layer type",
              hasGeoData: !!layer.qGeoData,
              hasAreaData: !!layer.qAreaData,
              hasHypercube: !!layer.qHyperCube
            };
            
            // Store layer information
            chartData.mapLayers.push(layerInfo);
            
            // Track if we found geo data
            if (layerInfo.hasGeoData || layerInfo.hasAreaData) {
              chartData.mapInfo.hasGeoData = true;
            }
            
            // Extract data from layer hypercube if available
            if (layer.qHyperCube) {
              if (config.DEBUG_MODE) {
                console.log(`[DEBUG] Processing map layer ${layerIndex} hypercube`);
              }
              
              // Add dimensions from this layer
              if (layer.qHyperCube.qDimensionInfo) {
                const layerDimensions = layer.qHyperCube.qDimensionInfo.map(dim => ({
                  name: dim.qFallbackTitle,
                  field: dim.qGroupFieldDefs ? dim.qGroupFieldDefs.join(', ') : ''
                }));
                chartData.dimensions = [...chartData.dimensions, ...layerDimensions];
                
                // Check for attribute expressions which might contain geo data
                layer.qHyperCube.qDimensionInfo.forEach((dim, dimIndex) => {
                  if (dim.qAttrExprInfo && dim.qAttrExprInfo.length > 0) {
                    // Store geo attributes
                    const geoAttributes = dim.qAttrExprInfo
                      .filter(attr => attr.id === 'locationOrLatitude' || 
                                     attr.id === 'longitude' || 
                                     attr.id.toLowerCase().includes('geo') ||
                                     (attr.qFallbackTitle && attr.qFallbackTitle.toLowerCase().includes('geo')))
                      .map((attr, attrIndex) => ({
                        dimension: dim.qFallbackTitle,
                        dimIndex: dimIndex,
                        attribute: attr.qFallbackTitle,
                        attrId: attr.id,
                        attrIndex: attrIndex
                      }));
                    
                    if (geoAttributes.length > 0) {
                      if (!chartData.geoAttributes) {
                        chartData.geoAttributes = [];
                      }
                      chartData.geoAttributes.push(...geoAttributes);
                    }
                  }
                });
              }
              
              // Add measures from this layer
              if (layer.qHyperCube.qMeasureInfo) {
                const layerMeasures = layer.qHyperCube.qMeasureInfo.map(meas => ({
                  name: meas.qFallbackTitle,
                  formula: meas.qDef,
                  format: meas.qNumFormat ? meas.qNumFormat.qFmt : ''
                }));
                chartData.measures = [...chartData.measures, ...layerMeasures];
              }
              
              // Get data from this layer
              let layerHasData = false;
              if (layer.qHyperCube.qDataPages && layer.qHyperCube.qDataPages.length > 0) {
                layer.qHyperCube.qDataPages.forEach(page => {
                  if (page.qMatrix && page.qMatrix.length > 0) {
                    page.qMatrix.forEach(row => {
                      // Process main cell data
                      const dataRow = row.map(cell => ({
                        value: cell.qText || "",
                        numValue: typeof cell.qNum === 'number' ? cell.qNum : null,
                        state: cell.qState || ""
                      }));
                      
                      // Extract attribute expressions (which often contain geo data)
                      row.forEach((cell, cellIndex) => {
                        if (cell.qAttrExps && cell.qAttrExps.qValues && cell.qAttrExps.qValues.length > 0) {
                          // Process each attribute in the cell
                          cell.qAttrExps.qValues.forEach((attrVal, attrIndex) => {
                            // Process geo attribute values
                            const geoAttr = chartData.geoAttributes ? 
                              chartData.geoAttributes.find(ga => ga.dimIndex === cellIndex && ga.attrIndex === attrIndex) : null;
                              
                            if (geoAttr || 
                                (attrVal.qText && attrVal.qText.includes('[') && attrVal.qText.includes(']'))) {
                              
                              // Create coordinate row for this location
                              const geoAttrRow = [
                                {value: layerInfo.name, numValue: layerIndex, state: 'L'},
                                {value: `Location for ${cell.qText || `Cell ${cellIndex}`}`, numValue: cellIndex, state: 'G'},
                                {value: attrVal.qText, numValue: null, state: 'C'}
                              ];
                              
                              chartData.data.push(geoAttrRow);
                              layerHasData = true;
                            }
                          });
                        }
                      });
                      
                      // Check if row has any non-empty values
                      const hasData = dataRow.some(cell => 
                        cell.value !== "" || 
                        (cell.numValue !== null && !isNaN(cell.numValue)));
                      
                      if (hasData) {
                        layerHasData = true;
                        
                        // Add layer index as first column to differentiate data from different layers
                        dataRow.unshift({
                          value: layerInfo.name,
                          numValue: layerIndex,
                          state: 'L'  // 'L' for layer
                        });
                        
                        chartData.data.push(dataRow);
                      }
                    });
                  }
                });
              }
              
              hasExtractedData = hasExtractedData || layerHasData;
            }
            
            // Extract data from geographic structure if available
            if (layer.qGeoData && layer.qGeoData.qFeatures) {
              if (config.DEBUG_MODE) {
                console.log(`[DEBUG] Processing map layer ${layerIndex} geographic data`);
              }
              
              // Create a structured representation of the geographic data
              let geoRows = [];
              
              try {
                // Extract data from geographic features
                layer.qGeoData.qFeatures.forEach((feature, featureIndex) => {
                  // Check if feature has properties
                  if (feature.qProperties) {
                    const props = feature.qProperties;
                    
                    // Create a structured row with properties
                    const geoRow = [
                      {value: layerInfo.name, numValue: layerIndex, state: 'L'},
                      {value: `Feature ${featureIndex + 1}`, numValue: featureIndex, state: 'G'}
                    ];
                    
                    // Add each property as a column
                    Object.keys(props).forEach(key => {
                      if (key !== 'qExpr') { // Skip expressions
                        const value = props[key];
                        const isNumber = !isNaN(parseFloat(value));
                        
                        geoRow.push({
                          value: String(value),
                          numValue: isNumber ? parseFloat(value) : null,
                          state: 'P' // Property
                        });
                      }
                    });
                    
                    // Only add if we have more than just the layer and feature columns
                    if (geoRow.length > 2) {
                      geoRows.push(geoRow);
                    }
                  }
                  
                  // Add coordinates if available
                  if (feature.qGeometry && feature.qGeometry.qCoordinates) {
                    // For point features, add the point coordinates
                    if (feature.qGeometry.qType === 'Point' && 
                        Array.isArray(feature.qGeometry.qCoordinates)) {
                      // Add a row for each point
                      const coords = feature.qGeometry.qCoordinates;
                      const coordRow = [
                        {value: layerInfo.name, numValue: layerIndex, state: 'L'},
                        {value: `Point ${featureIndex + 1}`, numValue: featureIndex, state: 'G'},
                        {value: 'Longitude', numValue: null, state: 'C'},
                        {value: String(coords[0]), numValue: coords[0], state: 'V'},
                        {value: 'Latitude', numValue: null, state: 'C'},
                        {value: String(coords[1]), numValue: coords[1], state: 'V'}
                      ];
                      
                      geoRows.push(coordRow);
                      
                      // Add a more easily parseable version with the full coordinate pair
                      const geoPointRow = [
                        {value: layerInfo.name, numValue: layerIndex, state: 'L'},
                        {value: `GeoPoint ${featureIndex + 1}`, numValue: featureIndex, state: 'G'},
                        {value: `[${coords[0]},${coords[1]}]`, numValue: null, state: 'C'}
                      ];
                      
                      geoRows.push(geoPointRow);
                    }
                  }
                });
                
                // Add geographic rows to chart data
                if (geoRows.length > 0) {
                  chartData.data = [...chartData.data, ...geoRows];
                  hasExtractedData = true;
                }
              } catch (error) {
                if (config.DEBUG_MODE) {
                  console.log(`[DEBUG] Error extracting geographic data from layer ${layerIndex}:`, error);
                }
              }
            }
            
            // Extract area data if available
            if (layer.qAreaData) {
              // Add basic information about areas
              try {
                if (layer.qAreaData.qAreas && layer.qAreaData.qAreas.length > 0) {
                  const areaRow = [
                    {value: layerInfo.name, numValue: layerIndex, state: 'L'},
                    {value: 'Area count', numValue: null, state: 'A'},
                    {value: String(layer.qAreaData.qAreas.length), numValue: layer.qAreaData.qAreas.length, state: 'V'}
                  ];
                  chartData.data.push(areaRow);
                  hasExtractedData = true;
                }
              } catch (error) {
                if (config.DEBUG_MODE) {
                  console.log(`[DEBUG] Error extracting area data from layer ${layerIndex}:`, error);
                }
              }
            }
          });
        } else if (layout.mapData) {
          // Alternative map data structure (used in some map types)
          if (config.DEBUG_MODE) {
            console.log("[DEBUG] Found mapData structure, extracting data");
          }
          
          chartData.mapInfo = {
            type: "Map visualization",
            dataSource: layout.mapData.qDataPages ? "Map data pages" : "Static map"
          };
          
          // Try to extract any data if present
          if (layout.mapData.qDataPages) {
            let mapDataRows = 0;
            
            layout.mapData.qDataPages.forEach(page => {
              if (page.qMatrix && page.qMatrix.length > 0) {
                page.qMatrix.forEach(row => {
                  // Extract cell data including empty cells
                  const dataRow = row.map(cell => ({
                    value: cell.qText || "",
                    numValue: typeof cell.qNum === 'number' ? cell.qNum : null,
                    state: cell.qState || ""
                  }));
                  
                  // Check if row has any data
                  const hasData = dataRow.some(cell => 
                    cell.value !== "" || 
                    (cell.numValue !== null && !isNaN(cell.numValue)));
                  
                  if (hasData) {
                    chartData.data.push(dataRow);
                    mapDataRows++;
                  }
                });
              }
            });
            
            hasExtractedData = mapDataRows > 0;
          }
          
          // Try to extract location info if available
          if (layout.mapData.locationInfo) {
            // Create locationInfo header row
            const locationRow = [{value: "Location Info", numValue: null, state: "H"}];
            
            // Add basic location properties
            Object.entries(layout.mapData.locationInfo).forEach(([key, value]) => {
              if (typeof value === 'string' || typeof value === 'number') {
                locationRow.push({
                  value: key + ": " + value,
                  numValue: typeof value === 'number' ? value : null,
                  state: "L"
                });
              }
            });
            
            if (locationRow.length > 1) {
              chartData.data.push(locationRow);
              hasExtractedData = true;
            }
          }
        }
        
        // Handle case where no data was extracted
        if (!hasExtractedData || chartData.data.length === 0) {
          if (config.DEBUG_MODE) {
            console.log("[DEBUG] No meaningful data could be extracted from map visualization");
          }
          
          // Add the map visualization info as text data
          chartData.data = [
            [{
              value: "Map visualization information",
              numValue: null,
              state: "H"
            }],
            [{
              value: `Type: ${visType}`,
              numValue: null,
              state: "I"
            }]
          ];
          
          // Add layer info if available
          if (chartData.mapLayers && chartData.mapLayers.length > 0) {
            chartData.mapLayers.forEach((layer, idx) => {
              chartData.data.push([{
                value: `Layer ${idx + 1}: ${layer.name} (${layer.type})`,
                numValue: null,
                state: "L"
              }]);
            });
          }
          
          // Add final message
          chartData.data.push([{
            value: "This map contains geographic data but no extractable tabular data",
            numValue: null,
            state: "M"
          }]);
        }
      } else {
        if (config.DEBUG_MODE) {
          console.log("[DEBUG] No hypercube or recognized data structure found in this visualization");
        }
        chartData.data = ["This visualization does not contain tabular data."];
      }
    
      return chartData;
    },

    /**
     * Fetch complete data for a table visualization
     * @param {string} objectId - The ID of the object
     * @param {object} chartData - The initial chart data
     * @returns {Promise} Promise resolving to the complete chart data
     */
    fetchTableData: function (objectId, chartData) {
      console.log("[DEBUG] Fetching complete table data for:", objectId);

      return new Promise(function (resolve, reject) {
        // Make sure we have a current app
        if (!currentApp) {
          currentApp = qlik.currApp();
        }

        // Get the object
        currentApp.getObject(objectId).then(function (model) {
          // Get the hypercube size
          const qSize = chartData.hypercubeSize;
          const qWidth = qSize.qcx;
          const qHeight = qSize.qcy;

          console.log("[DEBUG] Table dimensions:", qWidth, "x", qHeight);

          if (!qWidth || qWidth < 1) {
            delete chartData.needsDataFetch;
            delete chartData.hypercubeSize;
            resolve(chartData);
            return;
          }

          // HARD CAP: never fetch more than MAX_FETCH_CELLS cells. A wide/tall table
          // would otherwise spawn thousands of concurrent requests and freeze the tab.
          // Beyond the cap we truncate and flag it so the UI can warn the user.
          const MAX_CELLS_PER_PAGE = 10000;
          const maxCells = (config.DATA && config.DATA.MAX_FETCH_CELLS) || 50000;
          const concurrency = (config.DATA && config.DATA.FETCH_PAGE_CONCURRENCY) || 4;
          const maxRows = Math.max(1, Math.min(qHeight, Math.floor(maxCells / qWidth)));
          if (maxRows < qHeight) {
            chartData.dataTruncated = { fetched: maxRows, total: qHeight };
            console.warn("[DEBUG] Table truncated to", maxRows, "of", qHeight, "rows");
          }

          const pageHeight = Math.max(1, Math.floor(MAX_CELLS_PER_PAGE / qWidth));
          const numPages = Math.ceil(maxRows / pageHeight);
          console.log("[DEBUG] Will fetch", numPages, "pages (height", pageHeight + ") up to", maxRows, "rows");

          // Build page descriptors (bounded by maxRows).
          const pages = [];
          for (let i = 0; i < numPages; i++) {
            const pageTop = i * pageHeight;
            pages.push({ qTop: pageTop, qLeft: 0, qWidth: qWidth, qHeight: Math.min(pageHeight, maxRows - pageTop) });
          }

          // Dispatch pages in bounded batches (not all at once) to avoid saturating
          // the engine even within the cap.
          function runBatch(start) {
            const batch = pages.slice(start, start + concurrency);
            if (batch.length === 0) {
              delete chartData.needsDataFetch;
              delete chartData.hypercubeSize;
              console.log("[DEBUG] Processed", chartData.data.length, "rows of data");
              resolve(chartData);
              return;
            }
            Promise.all(batch.map(function (p) {
              return model.getHyperCubeData('/qHyperCubeDef', [p]);
            })).then(function (dataPages) {
              dataPages.forEach(function (page) {
                if (page && page[0] && page[0].qMatrix) {
                  page[0].qMatrix.forEach(function (row) {
                    chartData.data.push(row.map(function (cell) {
                      return { value: cell.qText, numValue: cell.qNum, state: cell.qState };
                    }));
                  });
                }
              });
              runBatch(start + concurrency);
            }).catch(function (error) {
              console.error("[DEBUG] Error fetching table data pages:", error);
              // Return whatever we already collected.
              delete chartData.needsDataFetch;
              delete chartData.hypercubeSize;
              resolve(chartData);
            });
          }
          runBatch(0);
        }).catch(function (error) {
          console.error("[DEBUG] Error getting object for data fetch:", error);
          reject(error);
        });
      });
    },

    /**
     * Get the current app context (tables, fields, etc.)
     * @returns {Promise} Promise resolving to the app context object
     */
    getAppContext: function() {
      console.log("[DEBUG] Starting app context collection");

      // Make sure we have a current app
      if (!currentApp) {
        currentApp = qlik.currApp();
        console.log("[DEBUG] Setting current app from qlik.currApp()");
      }

      var MAX_FIELDS = 500; // soft cap to bound token usage on huge models
      var doc = currentApp.model && currentApp.model.enigmaModel;

      var appContext = {
        appId: currentApp.id,
        appName: "",
        timestamp: new Date().toISOString(),
        tables: [],
        fields: [],
        masterDimensions: [],
        masterMeasures: []
      };

      if (!doc) {
        console.warn("[DEBUG] No enigma handle — returning minimal context");
        return Promise.resolve(appContext);
      }

      // Each source is individually caught so one failure never empties the rest.
      var pTitle = doc.evaluate('=DocumentTitle()').then(function(title) {
        appContext.appName = title || "Unknown";
      }, function() { appContext.appName = "Unknown"; });

      var pTables = doc.getTablesAndKeys(
        { qcx: 0, qcy: 0 }, { qcx: 0, qcy: 0 }, 30, true, false
      ).then(function(res) {
        var tables = (res && res.qtr) || [];
        appContext.tables = tables.map(function(t) {
          return {
            name: t.qName,
            fields: (t.qFields || []).map(function(f) { return f.qName; })
          };
        });
      }, function(err) {
        console.warn("[DEBUG] getTablesAndKeys failed:", err);
      });

      var pLists = doc.createSessionObject({
        qInfo: { qType: 'anthropic-context' },
        qFieldListDef: {
          qShowSystem: false, qShowHidden: false,
          qShowDerivedFields: false, qShowSemantic: true, qShowSrcTables: true
        },
        qDimensionListDef: {
          qType: 'dimension',
          qData: { title: '/qMetaDef/title', defs: '/qDim/qFieldDefs' }
        },
        qMeasureListDef: {
          qType: 'measure',
          qData: { title: '/qMetaDef/title', def: '/qMeasure/qDef' }
        }
      }).then(function(obj) {
        return obj.getLayout().then(function(layout) {
          var fieldItems = (layout.qFieldList && layout.qFieldList.qItems) || [];
          appContext._sessionFields = fieldItems.map(function(i) { return i.qName; });

          appContext.masterDimensions = ((layout.qDimensionList && layout.qDimensionList.qItems) || [])
            .map(function(i) {
              return {
                id: (i.qInfo && i.qInfo.qId) || "",
                name: (i.qMeta && i.qMeta.title) || (i.qData && i.qData.title) || "Unnamed",
                fields: (i.qData && i.qData.defs) || []
              };
            });

          appContext.masterMeasures = ((layout.qMeasureList && layout.qMeasureList.qItems) || [])
            .map(function(i) {
              return {
                id: (i.qInfo && i.qInfo.qId) || "",
                name: (i.qMeta && i.qMeta.title) || (i.qData && i.qData.title) || "Unnamed",
                expr: (i.qData && i.qData.def) || ""
              };
            });

          // Best-effort cleanup of the temporary session object.
          if (obj.id && doc.destroySessionObject) {
            doc.destroySessionObject(obj.id).catch(function() {});
          }
        });
      }, function(err) {
        console.warn("[DEBUG] field/master list session object failed:", err);
      });

      return Promise.all([pTitle, pTables, pLists]).then(function() {
        // Flat field list = union of table fields, falling back to the session
        // field list when tables couldn't be read.
        var seen = {};
        var flat = [];
        appContext.tables.forEach(function(t) {
          (t.fields || []).forEach(function(name) {
            if (name && !seen[name]) { seen[name] = true; flat.push(name); }
          });
        });
        if (flat.length === 0 && appContext._sessionFields) {
          appContext._sessionFields.forEach(function(name) {
            if (name && !seen[name]) { seen[name] = true; flat.push(name); }
          });
        }
        if (flat.length > MAX_FIELDS) flat = flat.slice(0, MAX_FIELDS);
        appContext.fields = flat.map(function(name) { return { name: name }; });
        delete appContext._sessionFields;

        console.log("[DEBUG] Context: " + appContext.tables.length + " tables, " +
          appContext.fields.length + " fields, " +
          appContext.masterMeasures.length + " measures, " +
          appContext.masterDimensions.length + " dimensions");
        return appContext;
      });
    },

    // Cache for the app context (data model / fields / master items). Collected
    // once per session so the data-model structure is sent to the LLM on first
    // use without re-evaluating the engine on every request.
    _appContextCache: null,

    /**
     * Get the app context, collected once per session and cached thereafter.
     * @returns {Promise} Promise resolving to the app context object
     */
    getAppContextCached: function() {
      if (this._appContextCache) {
        return Promise.resolve(this._appContextCache);
      }
      const self = this;
      return this.getAppContext().then(function(context) {
        self._appContextCache = context;
        return context;
      });
    },

    /**
     * Extract data from a hypercube or other Qlik Sense object
     * @param {object} objectData - The object data
     * @returns {object} Processed and structured data
     */
    processObjectData: function(objectData) {
      console.log("[DEBUG] Processing object data");

      if (!objectData) {
        console.warn("[DEBUG] No object data provided");
        return null;
      }

      try {
        // Return a simplified version of the data
        return {
          info: objectData.info || { title: "Unknown Chart", type: "Unknown" },
          data: objectData.data || [],
          dimensions: objectData.dimensions || [],
          measures: objectData.measures || []
        };
      } catch (e) {
        console.error("[DEBUG] Error processing object data:", e);
        return {
          error: "Error processing data: " + e.message,
          rawData: objectData
        };
      }
    },
    /**
     * Optimize chart data to reduce token usage
     * @param {object} chartData - The chart data to optimize
     * @param {object} options - Optimization options
     * @returns {object} Optimized chart data with size information
     */
    optimizeDataForTokens: function (chartData, options = {}) {
      if (config.DEBUG_MODE) {
        console.log("[DEBUG] Optimizing data for token efficiency");
        console.log("[DEBUG] Optimization options:", JSON.stringify(options));
      }

      if (!chartData) {
        return {
          error: "No chart data available",
          charCount: 0
        };
      }

      // Get original size for comparison
      const originalString = JSON.stringify(chartData);
      const originalSize = originalString.length;
      
      if (config.DEBUG_MODE) {
        console.log(`[DEBUG] Original data size: ${originalSize} characters`);
      }

      // Get default options from config settings
      const defaults = config.DATA.DEFAULT_OPTIMIZATION || {
        includeNumericValues: true, // Whether to include numeric values (qNum) in addition to text values
        includeDimensions: true,    // Whether to include dimension information
        includeMeasures: true,      // Whether to include measure information
        maxRows: 1000,              // Maximum number of rows to include
        simplifyStructure: true     // Whether to simplify the data structure
      };

      // Create settings by first copying defaults, then overriding with valid options
      const settings = {...defaults};
      
      // Override with options, but only if they are defined and valid
      if (options) {
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            // Special handling for maxRows to ensure it's a valid number
            if (key === 'maxRows' && typeof value === 'number' && !isNaN(value) && value > 0) {
              settings[key] = value;
              if (config.DEBUG_MODE) {
                console.log(`[DEBUG] Overriding maxRows with value from options: ${value}`);
              }
            } else if (key !== 'maxRows') {
              settings[key] = value;
            }
          }
        });
      }
      
      if (config.DEBUG_MODE) {
        console.log("[DEBUG] Final optimization settings:", JSON.stringify(settings));
      }

      // Create a minimal copy with only needed information
      const optimized = {
        info: chartData.info ? {
          title: chartData.info.title || "Untitled Chart",
          type: chartData.info.type || "Unknown"
        } : { title: "Unknown Chart", type: "Unknown" }
      };

      // Include current selections (simplified)
      if (chartData.currentSelections && Array.isArray(chartData.currentSelections)) {
        optimized.selections = chartData.currentSelections.map(sel => ({
          field: sel.field,
          values: sel.values
        }));
      }

      // Include dimensions if requested
      if (settings.includeDimensions && chartData.dimensions) {
        optimized.dimensions = chartData.dimensions.map(dim => ({
          name: dim.name || "Dimension",
          field: dim.field || ""
        }));
      }

      // Include measures if requested
      if (settings.includeMeasures && chartData.measures) {
        optimized.measures = chartData.measures.map(meas => ({
          name: meas.name || "Measure",
          formula: meas.formula || ""
        }));
      }

      // Handle data rows - the main optimization target
      if (chartData.data && chartData.data.length > 0) {
        // Store original row count
        optimized.rowCount = chartData.data.length;
        
        // Apply row limit if specified
        let dataToProcess = chartData.data;
        
        // Apply row limit if needed
        if (settings.maxRows && typeof settings.maxRows === 'number' && 
            !isNaN(settings.maxRows) && settings.maxRows > 0 && 
            dataToProcess.length > settings.maxRows) {
            
          if (config.DEBUG_MODE) {
            console.log(`[DEBUG] Limiting rows from ${dataToProcess.length} to ${settings.maxRows}`);
          }
          
          // Save the sampling info
          optimized.dataSampled = true;
          optimized.samplingRate = `${settings.maxRows}/${dataToProcess.length} rows sampled`;
          
          // Take a representative sample - first rows + some from the middle + last rows
          const firstChunk = Math.floor(settings.maxRows * 0.4); // 40% from beginning
          const lastChunk = Math.floor(settings.maxRows * 0.2);  // 20% from end
          const middleChunk = settings.maxRows - firstChunk - lastChunk; // Rest from middle
          
          const firstRows = dataToProcess.slice(0, firstChunk);
          const lastRows = dataToProcess.slice(-lastChunk);
          
          // Get rows from the middle
          const middleStart = Math.floor((dataToProcess.length - middleChunk) / 2);
          const middleRows = dataToProcess.slice(middleStart, middleStart + middleChunk);
          
          dataToProcess = [...firstRows, ...middleRows, ...lastRows];
        }
        
        // Create a cleaner data structure with values
        if (settings.simplifyStructure) {
          optimized.data = dataToProcess.map(row => {
            if (Array.isArray(row)) {
              if (settings.includeNumericValues) {
                // Include both text and numeric values with cleaner property names
                return row.map(cell => {
                  // Complex extraction logic that preserves all possible values
                  let textValue = null;
                  let numValue = null;
                  
                  // Try all possible text value properties - preserve null/undefined
                  if (cell.value !== undefined && cell.value !== null) textValue = cell.value;
                  else if (cell.qText !== undefined && cell.qText !== null) textValue = cell.qText;
                  else if (cell.text !== undefined && cell.text !== null) textValue = cell.text;
                  
                  // Only convert null/undefined to empty string at the end
                  textValue = textValue === null || textValue === undefined ? "" : String(textValue);
                  
                  // Try all possible numeric value properties - preserve nulls
                  if (cell.numValue !== undefined && !isNaN(cell.numValue)) numValue = cell.numValue;
                  else if (cell.qNum !== undefined && !isNaN(cell.qNum)) numValue = cell.qNum;
                  else if (cell.num !== undefined && !isNaN(cell.num)) numValue = cell.num;
                  // If numeric values are NaN but we have a string representation with digits
                  else if (textValue && /^-?\d+(\.\d+)?$/.test(textValue)) {
                    numValue = parseFloat(textValue);
                  }
                  
                  // Special case for geographic data which might have explicit 0 values
                  const isExplicitZero = 
                    (cell.numValue === 0 || cell.qNum === 0 || cell.num === 0) && textValue === "0";
                  
                  return {
                    text: textValue,
                    num: isExplicitZero ? 0 : numValue,
                    state: cell.state || cell.qState || ""
                  };
                });
              } else {
                // Just include text values
                return row.map(cell => cell.value || cell.qText || "");
              }
            } else {
              return [row.value || row.qText || ""];
            }
          });
        } else {
          // Preserve more of the original structure
          optimized.data = dataToProcess;
        }

        if (config.DEBUG_MODE) {
          console.log(`[DEBUG] Optimized data structure with ${optimized.data.length} rows (from ${chartData.data.length})`);
        }
      } else {
        // No data to optimize
        optimized.data = [];
        if (config.DEBUG_MODE) {
          console.log("[DEBUG] No data rows found to optimize");
        }
      }

      // Get optimized size
      const optimizedString = JSON.stringify(optimized);
      const optimizedSize = optimizedString.length;
      
      // Add size metrics
      optimized.metrics = {
        originalSize: originalSize,
        optimizedSize: optimizedSize,
        reduction: originalSize > 0 ? Math.round((1 - (optimizedSize / originalSize)) * 100) : 0,
        tokenEstimate: Math.ceil(optimizedSize / 4) // Rough estimate: 4 chars per token
      };
      
      if (config.DEBUG_MODE) {
        console.log(`[DEBUG] Optimized data size: ${optimizedSize} characters (${optimized.metrics.reduction}% reduction)`);
      }

      return optimized;
    },

    /**
     * Legacy method for backward compatibility
     * @param {function} callback - Callback function when a visualization is selected
     */
    setupSelectionTracking: function(callback) {
      console.log("[DEBUG] Legacy setupSelectionTracking called");
      selectionCallback = callback;

      // Initialize the app if needed
      if (!currentApp) {
        currentApp = qlik.currApp();
      }

      // Add selection styles
      this.addSelectionStyles();

      // We won't automatically start tracking here, but we'll store the callback
      console.log("[DEBUG] Selection callback stored, but tracking not started");
    }
  };
});
