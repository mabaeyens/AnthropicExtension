define([], function() {
  'use strict';

  return {
    /**
     * Format chart data for LLM consumption with minimal tokens
     * @param {object} chartData - The chart data to format
     * @returns {object} Formatted data with character count info
     */
    formatForLLM: function(chartData) {
      if (!chartData) {
        return {
          data: "No chart data available",
          charCount: 24
        };
      }
      
      // Create a clean structure with only essential information
      const result = {
        metadata: {
          title: chartData.info?.title || "Untitled Chart",
          type: chartData.info?.type || "Unknown Chart Type",
          dimensions: [],
          measures: []
        },
        data: []
      };
      
      // Add dimensions (column names/fields)
      if (chartData.dimensions && Array.isArray(chartData.dimensions)) {
        chartData.dimensions.forEach(dim => {
          if (dim && dim.name) {
            result.metadata.dimensions.push(dim.name);
          }
        });
      }
      
      // Add measures (metrics/calculations)
      if (chartData.measures && Array.isArray(chartData.measures)) {
        chartData.measures.forEach(measure => {
          if (measure && measure.name) {
            result.metadata.measures.push(measure.name);
          }
        });
      }
      
      // Get headers from dimensions and measures
      const headers = [
        ...result.metadata.dimensions,
        ...result.metadata.measures
      ];
      
      // Clean data rows - convert to simple arrays of values
      if (chartData.data && Array.isArray(chartData.data)) {
        // Create the table header row if we have headers
        if (headers.length > 0) {
          result.data.push(headers);
        }
        
        // Add data rows
        chartData.data.forEach(row => {
          if (Array.isArray(row)) {
            // Extract only the values from each row
            const cleanRow = row.map(cell => {
              // Handle different cell formats
              if (cell === null || cell === undefined) {
                return "";
              } else if (typeof cell === "object") {
                return cell.value || cell.text || "";
              } else {
                return cell.toString();
              }
            });
            
            result.data.push(cleanRow);
          }
        });
      }
      
      // Add current selections if available
      if (chartData.currentSelections && chartData.currentSelections.length > 0) {
        result.metadata.selections = chartData.currentSelections.map(sel => ({
          field: sel.field,
          values: sel.values
        }));
      }
      
      // Convert to JSON string for token estimation (no pretty print)
      const resultString = JSON.stringify(result);
      
      return {
        data: result,
        formatted: this.formatAsTable(result.data, headers),
        charCount: resultString.length,
        tokenEstimate: Math.ceil(resultString.length / 4) // Rough estimate: ~4 chars per token
      };
    },
    
    /**
     * Format data as a clean text table for LLM consumption
     * @param {Array<Array>} rows - Table data rows
     * @param {Array<string>} headers - Column headers (optional)
     * @returns {string} Formatted table as text
     */
    formatAsTable: function(rows, headers) {
      if (!rows || !rows.length) {
        return "No data available";
      }
      
      let tableText = "";
      
      // If first row contains headers, use them
      if (!headers && rows.length > 0) {
        headers = rows[0];
        rows = rows.slice(1);
      }
      
      // Calculate column widths for nice formatting
      const colWidths = [];
      
      // Initialize with header widths
      if (headers) {
        headers.forEach((header, i) => {
          colWidths[i] = header.toString().length;
        });
      }
      
      // Adjust for data widths
      rows.forEach(row => {
        if (Array.isArray(row)) {
          row.forEach((cell, i) => {
            const cellStr = (cell !== null && cell !== undefined) ? cell.toString() : "";
            colWidths[i] = Math.max(colWidths[i] || 0, cellStr.length);
          });
        }
      });
      
      // Add some padding
      colWidths = colWidths.map(w => w + 2);
      
      // Create header row
      if (headers) {
        headers.forEach((header, i) => {
          tableText += header.toString().padEnd(colWidths[i]);
        });
        tableText += "\n";
        
        // Add separator row
        headers.forEach((_, i) => {
          tableText += "-".repeat(colWidths[i]);
        });
        tableText += "\n";
      }
      
      // Add data rows
      rows.forEach(row => {
        if (Array.isArray(row)) {
          row.forEach((cell, i) => {
            const cellStr = (cell !== null && cell !== undefined) ? cell.toString() : "";
            tableText += cellStr.padEnd(colWidths[i]);
          });
          tableText += "\n";
        }
      });
      
      return tableText;
    },
    
    /**
     * Create a size report for the data
     * @param {number} originalChars - Original character count
     * @param {number} optimizedChars - Optimized character count
     * @returns {string} Formatted size report
     */
    createSizeReport: function(originalChars, optimizedChars) {
      const originalTokens = Math.ceil(originalChars / 4);
      const optimizedTokens = Math.ceil(optimizedChars / 4);
      const reduction = 100 - Math.round((optimizedChars / originalChars) * 100);
      
      return `Data size: ${optimizedChars.toLocaleString()} chars / ~${optimizedTokens.toLocaleString()} tokens ` + 
             `(reduced from ${originalChars.toLocaleString()} chars / ~${originalTokens.toLocaleString()} tokens, ` +
             `${reduction}% reduction)`;
    },
    
    /**
     * Extract city names and values from qDataPages
     * @param {object} chartData - The chart data containing qDataPages
     * @returns {Array} Array of objects with city names and values
     */
    extractCityValues: function(chartData) {
      if (!chartData) return [];
      
      const cityValues = [];
      
      // IMPORTANT: First check for map data in qUndoExclude structure (Qlik map charts)
      if (chartData.qUndoExclude && 
          chartData.qUndoExclude.gaLayers && 
          chartData.qUndoExclude.gaLayers.length > 0 &&
          chartData.qUndoExclude.gaLayers[0].qHyperCube &&
          chartData.qUndoExclude.gaLayers[0].qHyperCube.qDataPages &&
          chartData.qUndoExclude.gaLayers[0].qHyperCube.qDataPages.length > 0) {
        
        // Process the qMatrix from qUndoExclude structure
        const qMatrix = chartData.qUndoExclude.gaLayers[0].qHyperCube.qDataPages[0].qMatrix;
        
        if (qMatrix && Array.isArray(qMatrix)) {
          qMatrix.forEach(row => {
            if (row && row.length > 0 && row[0].qAttrExps && row[0].qAttrExps.qValues) {
              // Extract city name from qText
              const cityName = row[0].qText;
              
              // Extract value from the second attribute (index 1), which contains the count
              const valueAttr = row[0].qAttrExps.qValues[1];
              const value = valueAttr && valueAttr.qNum !== undefined ? valueAttr.qNum : null;
              
              if (cityName && value !== null) {
                cityValues.push({
                  city: cityName,
                  value: value
                });
              }
            }
          });
        }
      }
      
      // If we found values in the qUndoExclude structure, return them
      if (cityValues.length > 0) {
        return cityValues;
      }
      
      // Otherwise, try standard paths as fallback
      
      // Check if we have qDataPages in the main chart data structure
      if (chartData.qDataPages) {
        this.processQDataPages(chartData.qDataPages, cityValues);
      }
      
      // Check for qDataPages in the mapData structure (common in map visualizations)
      if (chartData.mapData && chartData.mapData.qDataPages) {
        this.processQDataPages(chartData.mapData.qDataPages, cityValues);
      }
      
      // Check for qDataPages in each layer of map visualizations
      if (chartData.qLayerData && Array.isArray(chartData.qLayerData)) {
        chartData.qLayerData.forEach(layer => {
          if (layer.qHyperCube && layer.qHyperCube.qDataPages) {
            this.processQDataPages(layer.qHyperCube.qDataPages, cityValues);
          }
        });
      }
      
      // Check gaLayers for qHyperCube
      if (chartData.gaLayers && Array.isArray(chartData.gaLayers)) {
        chartData.gaLayers.forEach(layer => {
          if (layer.qHyperCube && layer.qHyperCube.qDataPages) {
            this.processQDataPages(layer.qHyperCube.qDataPages, cityValues);
          }
        });
      }
      
      // Process standard data array if we haven't found any qDataPages
      if (cityValues.length === 0 && chartData.data && Array.isArray(chartData.data)) {
        this.processFlatData(chartData.data, cityValues);
      }
      
      return cityValues;
    },
    
    /**
     * Process qDataPages to extract city names and values
     * @param {Array} qDataPages - The qDataPages array
     * @param {Array} cityValues - Array to populate with city-value pairs
     */
    processQDataPages: function(qDataPages, cityValues) {
      if (!Array.isArray(qDataPages)) return;
      
      qDataPages.forEach(page => {
        if (page.qMatrix && Array.isArray(page.qMatrix)) {
          page.qMatrix.forEach(row => {
            if (Array.isArray(row) && row.length >= 2) {
              // Extract first column as city name, second column as value
              const cityCell = row[0];
              const valueCell = row[1];
              
              // Extract city text from various possible formats
              let cityName = null;
              if (typeof cityCell === 'object') {
                cityName = cityCell.qText || cityCell.value || cityCell.text;
              } else {
                cityName = String(cityCell);
              }
              
              // Extract value from various possible formats
              let value = null;
              if (typeof valueCell === 'object') {
                // Prefer numeric values for the value column
                if (valueCell.qNum !== undefined && !isNaN(valueCell.qNum)) {
                  value = valueCell.qNum;
                } else if (valueCell.numValue !== undefined && !isNaN(valueCell.numValue)) {
                  value = valueCell.numValue;
                } else if (valueCell.num !== undefined && !isNaN(valueCell.num)) {
                  value = valueCell.num;
                } else {
                  // Fallback to text values
                  value = valueCell.qText || valueCell.value || valueCell.text;
                  
                  // Try to convert to number if it looks like a number
                  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
                    value = parseFloat(value);
                  }
                }
              } else if (typeof valueCell === 'number') {
                value = valueCell;
              } else if (typeof valueCell === 'string' && /^-?\d+(\.\d+)?$/.test(valueCell.trim())) {
                value = parseFloat(valueCell);
              } else {
                value = valueCell;
              }
              
              // Only add if we have both city and value
              if (cityName && value !== null && value !== undefined) {
                cityValues.push({
                  city: cityName,
                  value: value
                });
              }
            }
          });
        }
      });
    },
    
    /**
     * Process flat data array to extract city names and values
     * @param {Array} data - The flat data array
     * @param {Array} cityValues - Array to populate with city-value pairs
     */
    processFlatData: function(data, cityValues) {
      if (!Array.isArray(data)) return;
      
      data.forEach(row => {
        if (Array.isArray(row) && row.length >= 2) {
          // Extract first column as city name, second column as value
          const cityCell = row[0];
          const valueCell = row[1];
          
          // Extract city text
          let cityName = null;
          if (cityCell === null || cityCell === undefined) {
            return; // Skip rows with no city
          } else if (typeof cityCell === 'object') {
            cityName = cityCell.value || cityCell.text || cityCell.numValue?.toString() || "";
          } else {
            cityName = String(cityCell);
          }
          
          // Extract value
          let value = null;
          if (valueCell === null || valueCell === undefined) {
            return; // Skip rows with no value
          } else if (typeof valueCell === 'object') {
            // Prefer numeric values for the value
            if (valueCell.numValue !== undefined && !isNaN(valueCell.numValue)) {
              value = valueCell.numValue;
            } else if (valueCell.num !== undefined && !isNaN(valueCell.num)) {
              value = valueCell.num;
            } else {
              // Fallback to text values
              value = valueCell.value || valueCell.text || "";
              
              // Try to convert to number if it looks like a number
              if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
                value = parseFloat(value);
              }
            }
          } else if (typeof valueCell === 'number') {
            value = valueCell;
          } else if (typeof valueCell === 'string' && /^-?\d+(\.\d+)?$/.test(valueCell.trim())) {
            value = parseFloat(valueCell);
          } else {
            value = valueCell;
          }
          
          // Only add if we have both city and value
          if (cityName && value !== null && value !== undefined) {
            cityValues.push({
              city: cityName,
              value: value
            });
          }
        }
      });
    },
    
    /**
     * Format city values as a table string
     * @param {Array} cityValues - Array of city-value objects
     * @returns {string} Formatted table of city values
     */
    formatCityValuesTable: function(cityValues) {
      if (!cityValues || cityValues.length === 0) {
        return "No city data found";
      }
      
      // Sort by value in descending order (highest values first)
      const sortedValues = [...cityValues].sort((a, b) => b.value - a.value);
      
      // Calculate column widths for better formatting
      let cityColWidth = 4; // Minimum width for "City"
      let valueColWidth = 5; // Minimum width for "Value"
      
      // Find the maximum width needed for each column
      sortedValues.forEach(item => {
        cityColWidth = Math.max(cityColWidth, item.city.length);
        valueColWidth = Math.max(valueColWidth, String(item.value).length);
      });
      
      // Add some padding
      cityColWidth += 2;
      valueColWidth += 2;
      
      // Create header row
      let table = "City".padEnd(cityColWidth) + "Value".padEnd(valueColWidth) + "\n";
      table += "-".repeat(cityColWidth) + "-".repeat(valueColWidth) + "\n";
      
      // Add each city-value pair
      sortedValues.forEach(item => {
        table += item.city.padEnd(cityColWidth) + String(item.value).padEnd(valueColWidth) + "\n";
      });
      
      // Add summary
      table += `\n(Total: ${sortedValues.length} cities)\n`;
      
      return table;
    }
  };
});