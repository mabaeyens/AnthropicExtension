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
      
        // Extract the object ID. Qlik sets the real object id on the sheet
        // cell's `tid` attribute — this is reliable across versions. The
        // qv-object-<id> CSS class is a fragile fallback because the element
        // also carries a qv-object-<type> class (e.g. qv-object-barchart),
        // and the old regex could grab the type instead of the id.
        const objectId = this.extractObjectId($target, $vizObject);

        if (!objectId) {
          console.log("[DEBUG] Could not extract object ID from element");
          // Surface a copyable DOM dump so the id-bearing attribute can be
          // identified without another blind round-trip. Only fires when the
          // GUID-by-shape walk found nothing (rare).
          if ($vizObject.length && selectionCallback) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            selectionCallback(null, null, { objectId: null, dom: this.describeDomChain($target) });
          }
          return;
        }
      
        // Skip if this is our extension object
        if (objectId === extensionId) {
          console.log("[DEBUG] Ignoring click on extension object");
          return;
        }
      
        // Skip if this object contains our extension
        if ($vizObject.find('#' + extensionId).length ||
            $vizObject.find('[data-object-id="' + extensionId + '"]').length) {
          console.log("[DEBUG] Ignoring click on container with extension");
          return;
        }
      
        console.log("[DEBUG] Valid visualization selected:", objectId);
      
        if (objectId) {
          console.log("[DEBUG] Visualization clicked in selection mode:", objectId);

          // Prevent default behavior. stopImmediatePropagation is essential:
          // this handler runs in the capture phase (see addEventListener below),
          // so stopping propagation here keeps the click from ever reaching
          // Qlik's own chart handlers, which would otherwise select values.
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          // Get the object data
          this.getObjectData(objectId).then(function(chartData) {
            // Call the callback with the chart data
            if (selectionCallback) {
              selectionCallback(objectId, chartData);
            }
          }.bind(this)).catch(function(error) {
            console.error("[DEBUG] Error getting object data for", objectId, ":", error);
            // Signal failure cleanly — null id/data tell the UI to show an error
            // without storing invalid data as a chart selection. Pass the real
            // error so the panel can surface why it failed.
            if (selectionCallback) {
              selectionCallback(null, null, { objectId: objectId, error: error });
            }
          });
        }
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
      var GUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

      // 1. Find the object id by its SHAPE (a GUID) rather than by a specific
      //    attribute name. Walk up from the clicked element and return the
      //    nearest attribute value that contains a GUID. This works across Qlik
      //    versions and viz types: native charts, master-item vizzes, and
      //    Visualization-bundle vizzes (e.g. distributionplot) whose .qv-object
      //    class carries only the TYPE (qv-object-distributionplot), not the id.
      var el = $target[0];
      while (el && el !== document.body) {
        if (el.attributes) {
          for (var i = 0; i < el.attributes.length; i++) {
            var m = (el.attributes[i].value || '').match(GUID);
            if (m && m[0] !== extensionId) return m[0];
          }
        }
        el = el.parentElement;
      }

      // 2. Fall back to a GUID inside the .qv-object class list.
      var cls = ($vizObject.attr('class') || '');
      var clsMatch = cls.match(GUID);
      if (clsMatch && clsMatch[0] !== extensionId) return clsMatch[0];

      // 3. Last resort: legacy qv-object-<token> behaviour for charts whose id is
      //    a short non-GUID token. Skip known type words.
      var tokens = (cls.match(/qv-object-([a-zA-Z0-9_-]+)/g) || [])
        .map(function (t) { return t.replace('qv-object-', ''); })
        .filter(function (t) { return t !== 'distributionplot' && /[A-Z0-9]/.test(t); });
      return tokens[0] || null;
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
                    maxRows: 10000 // Use a high default to avoid limiting too early
                  });
                  resolve(optimizedData);
                }.bind(this)).catch(function (error) {
                  console.error("[DEBUG] Error fetching table data:", error);
                  // Optimize what we have - use high limits
                  const optimizedData = this.optimizeDataForTokens(chartData, {
                    maxRows: 10000 // Use a high default to avoid limiting too early
                  });
                  resolve(optimizedData); // Return what we have
                }.bind(this));
              } else {
                // No need to fetch more data, optimize and return
                const optimizedData = this.optimizeDataForTokens(chartData, {
                  maxRows: 10000 // Use a high default to avoid limiting too early
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

      return new Promise(function (resolve, reject) {
        // Make sure we have a current app
        if (!currentApp) {
          currentApp = qlik.currApp();
        }

        // Get the list of current selections
        currentApp.getList("CurrentSelections", function (reply) {
          if (reply && reply.qSelectionObject && reply.qSelectionObject.qSelections) {
            const selections = reply.qSelectionObject.qSelections.map(selection => ({
              field: selection.qField,
              values: selection.qSelected,
              count: selection.qSelectedCount
            }));

            console.log("[DEBUG] Current selections:", selections.length);
            resolve(selections);
          } else {
            console.log("[DEBUG] No current selections");
            resolve([]);
          }
        });
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
                  maxRows: 10000 // Use a high default to avoid limiting too early
                });
                resolve(optimizedData);
              }.bind(this)).catch(function (error) {
                console.error("[DEBUG] Error fetching table data (fallback):", error);
                // Optimize what we have
                const optimizedData = this.optimizeDataForTokens(chartData, {
                  maxRows: 10000 // Use a high default to avoid limiting too early
                });
                resolve(optimizedData); // Return what we have
              }.bind(this));
            } else {
              // No need to fetch more data, optimize and return
              const optimizedData = this.optimizeDataForTokens(chartData, {
                maxRows: 10000 // Use a high default to avoid limiting too early
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
    
        // Check if we have table data and need to fetch more
        if (chartData.data.length === 0 &&
            layout.qHyperCube.qSize &&
            layout.qHyperCube.qSize.qcy > 0) {
    
          // We need to fetch the data separately for tables
          if (config.DEBUG_MODE) {
            console.log("[DEBUG] Table detected with data size:",
                     layout.qHyperCube.qSize.qcx + "x" + layout.qHyperCube.qSize.qcy);
          }
    
          // Mark that we need to fetch data
          chartData.needsDataFetch = true;
          chartData.hypercubeSize = layout.qHyperCube.qSize;
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

          // Calculate how many pages we need
          // Maximum 10,000 cells per request
          const MAX_CELLS_PER_PAGE = 10000;
          const pageHeight = Math.floor(MAX_CELLS_PER_PAGE / qWidth);
          const numPages = Math.ceil(qHeight / pageHeight);

          console.log("[DEBUG] Will fetch", numPages, "pages with height", pageHeight);

          // Prepare requests for all pages
          const pagePromises = [];

          for (let i = 0; i < numPages; i++) {
            const pageTop = i * pageHeight;
            const pageSize = Math.min(pageHeight, qHeight - pageTop);

            // Request this page
            const pagePromise = model.getHyperCubeData('/qHyperCubeDef', [{
              qTop: pageTop,
              qLeft: 0,
              qWidth: qWidth,
              qHeight: pageSize
            }]);

            pagePromises.push(pagePromise);
          }

          // Execute all page requests
          Promise.all(pagePromises).then(function (dataPages) {
            console.log("[DEBUG] Received", dataPages.length, "data pages");

            // Process all the pages
            dataPages.forEach(function (page) {
              if (page && page[0] && page[0].qMatrix) {
                page[0].qMatrix.forEach(row => {
                  const dataRow = row.map(cell => ({
                    value: cell.qText,
                    numValue: cell.qNum,
                    state: cell.qState
                  }));
                  chartData.data.push(dataRow);
                });
              }
            });

            console.log("[DEBUG] Processed", chartData.data.length, "rows of data");

            // Remove the fetch flag
            delete chartData.needsDataFetch;
            delete chartData.hypercubeSize;

            // Return the complete data
            resolve(chartData);
          }).catch(function (error) {
            console.error("[DEBUG] Error fetching table data pages:", error);

            // Even if we have an error, return what we have
            delete chartData.needsDataFetch;
            delete chartData.hypercubeSize;
            resolve(chartData);
          });
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

      return new Promise(function(resolve, reject) {
        try {
          // Create a basic context object with app info
          const appContext = {
            appId: currentApp.id,
            appName: "",
            timestamp: new Date().toISOString(),
            tables: [],
            fields: []
          };

          // Try to get the app name
          currentApp.model.enigmaModel.evaluate('=DocumentTitle()').then(function(title) {
            appContext.appName = title;
            console.log("[DEBUG] App name retrieved:", title);
          }).catch(function(err) {
            console.warn("[DEBUG] Could not get app title:", err);
            appContext.appName = "Unknown";
          });

          // Check if we can use the new way to get tables and fields
          if (typeof currentApp.getObjects === 'function') {
            console.log("[DEBUG] Using getObjects API method");

            // Get list of master items to extract fields
            currentApp.getObjects({
              qTypes: ['masterobject'],
              qData: {}
            }).then(function(objects) {
              console.log("[DEBUG] Retrieved master objects:", objects.length);

              // Get list of available fields
              return currentApp.model.enigmaModel.evaluate('[$(=FieldList())];');
            }).then(function(fieldListStr) {
              console.log("[DEBUG] Field list string retrieved");

              try {
                // Parse field list (it's returned as a string)
                let fieldNames = fieldListStr.replace(/[\[\]']/g, '').split(',');
                fieldNames = fieldNames.map(f => f.trim());

                appContext.fields = fieldNames.map(fieldName => {
                  return { name: fieldName };
                });

                console.log("[DEBUG] Parsed fields:", appContext.fields.length);

                // Since we don't have direct table info, create a placeholder
                appContext.tables = [{
                  name: "App Data Model",
                  fields: fieldNames
                }];

                console.log("[DEBUG] Context collection complete");
                resolve(appContext);
              } catch (e) {
                console.error("[DEBUG] Error parsing field list:", e);
                // Even if we have an error, return the partial context
                resolve(appContext);
              }
            }).catch(function(err) {
              console.warn("[DEBUG] Error getting objects or fields:", err);
              // Return the partial context
              resolve(appContext);
            });
          } else {
            // Try a more basic approach
            console.log("[DEBUG] Using alternative approach for data model");

            // Use the global API to get field list
            const app = qlik.currApp();

            app.model.enigmaModel.evaluate('[$(=FieldList())]').then(function(fieldListStr) {
              console.log("[DEBUG] Basic field list retrieved");

              // Process field list
              try {
                // Parse field list (it's returned as a string)
                let fieldNames = fieldListStr.replace(/[\[\]']/g, '').split(',');
                fieldNames = fieldNames.map(f => f.trim());

                appContext.fields = fieldNames.map(fieldName => {
                  return { name: fieldName };
                });

                // Create a single table entry
                appContext.tables = [{
                  name: "Data Model",
                  fields: fieldNames
                }];

                console.log("[DEBUG] Basic context collection complete");
                resolve(appContext);
              } catch (e) {
                console.error("[DEBUG] Error in basic approach:", e);
                // Return what we have
                resolve(appContext);
              }
            }).catch(function(err) {
              console.warn("[DEBUG] Error in basic field list:", err);
              // Just return the app ID
              resolve(appContext);
            });
          }
        } catch (e) {
          console.error("[DEBUG] Global error in getAppContext:", e);
          reject("Error collecting app context: " + e.message);
        }
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
