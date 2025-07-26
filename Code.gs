/**
 * Linked Slides Add-on - Google Apps Script server-side code.
 * Copyright (C) 2025 Green Duck Punch, LLC
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * This file is part of the Linked Slides Add-on. The Linked Slides Add-on is
 * dual-licensed under the AGPLv3 and a commercial/proprietary license.
 * For a proprietary license, please contact Green Duck Punch, LLC.
 *
 * @OnlyCurrentDoc
 *
 * The above tag tells Google Apps Script that this script is only intended
 * to be run from within the Google Slides document it is bound to.
 *
 */

/**
 * Adds a custom menu to the Google Slides UI when the presentation is opened.
 * This function is designed for a Google Workspace Add-on, appearing under the
 * "Extensions" menu.
 *
 * If you are running this as a container-bound script (not an add-on),
 * you should change `createAddonMenu()` to `createMenu('Linked Slides Add-on')`.
 * Example for container-bound:
 * function onOpen() {
 * SlidesApp.getUi()
 * .createMenu('Linked Slides Add-on') // Creates a custom menu in the presentation's menu bar
 * .addItem('Find linked slides', 'findLinkedSlides')
 * .addToUi();
 * }
 */
function onOpen() {
  SlidesApp.getUi()
      .createAddonMenu() // Appropriate for Google Workspace Add-on deployment
      .addItem('Find linked copies', 'launchLinkedSlides')
      .addToUi();
}


/**
 * Launches the link finder if it's not already launching. This ensures that 
 * if the user selects the menu item again, another dialog won't be shown when 
 * the first one closes.
 */
function launchLinkedSlides() {
  const userCache = CacheService.getUserCache();
  if (userCache.get('is_launching')) {
    return;
  }
  userCache.put('is_launching', 'true', 60);
  try {
    findLinkedSlides();
  } finally {
    userCache.remove('is_launching');
  }
}

/**
 * Opens a dialog to prompt the user for presentation IDs to search.
 * This function is the entry point for the "Find Linked Slides" menu item.
 * It also passes the OAuth token to the HTML for Picker API authentication.
 */
function findLinkedSlides() {
    // Enforce licensing. If the user is not licensed, this function will
  // show a dialog and return false, stopping further execution.
  if (typeof _enforceLicense !== 'undefined' && !_enforceLicense()) {
    return;
  }

  // Get the OAuth token for the current user. This token is required by the Picker API
  // to authenticate the user and access their Google Drive files.
  const oauthToken = ScriptApp.getOAuthToken();

  // Retrieve previously selected files for this presentation from user properties.
  const presentationId = SlidesApp.getActivePresentation().getId();
  const userProperties = PropertiesService.getUserProperties();
  const propertyKey = `linkedSlides.selectedFileIds.${presentationId}`;
  const initialFileIdsJson = userProperties.getProperty(propertyKey);

  // Create a template from the HTML file. This allows us to pass variables
  // (like the OAuth token) from the server-side script to the client-side HTML.
  const template = HtmlService.createTemplateFromFile('PresentationIdInput');
  template.oauthToken = oauthToken; // Pass the token to the template
  // Pass the saved files (or an empty array string) to the template.
  template.initialFileIdsJson = initialFileIdsJson || '[]';
  
  // Evaluate the template to get the final HTML output.
  // Set the title, dimensions, and sandbox mode for the dialog.
  const htmlOutput = template.evaluate()
      .setTitle('Find Linked Slides')
      .setWidth(1000) // Increased width to better accommodate the Picker
      .setHeight(600)  // Increased height to better accommodate the Picker
      .setSandboxMode(HtmlService.SandboxMode.IFRAME); // IFRAME mode is recommended for security

  // Display the dialog.
  SlidesApp.getUi().showModalDialog(htmlOutput, 'Find Linked Slides');
}

/**
 * Performs the search for linked slides based on user input and updates the sidebar.
 * This function is called by the HTML dialog via google.script.run.
 *
 * @param {string} presentationIdsString A comma-separated string of Google Slides presentation IDs.
 */
function _performLinkedSlideSearch(presentationIdsString) {
  const ui = SlidesApp.getUi();
  try {
    const userCache = CacheService.getUserCache();
    const presentationId = SlidesApp.getActivePresentation().getId();
    const isSearchingKey = `is_searching_${presentationId}`;
    if (userCache.get(isSearchingKey)) {
      ui.alert("A search is already in progress. Please wait for it to finish.");
      return;
    }
    try {
      userCache.put(isSearchingKey, 'true', 5*60); //Prevent overlapping searches for 5 minutes
      const progressHtml = HtmlService.createHtmlOutput("Searching for linked slides...").setTitle('Linked Slides Search');
      ui.showSidebar(progressHtml);
      const resultsHtml = generateSearchResults_(presentationIdsString);
      ui.showSidebar(resultsHtml);  
    } finally {
      userCache.remove(isSearchingKey);
    }
  } catch (e) {
    console.error(`Error in _performLinkedSlideSearch: ${e.toString()}`);
    ui.showSidebar(HtmlService.createHtmlOutput("Search for linked slides failed. Please try again. If the problem persists, please contact support@greenduckpunch.com.").setTitle('Linked Slides Error'));
  }
}

/**
 * Searches for slides in the specified presentations that are linked copies of the slides in the
 * active presentation and returns a webpage of search results.
 * This function is called internally by _performLinkedSlidesSearch()
 *
 * @param {string} presentationIdsString A comma-separated string of Google Slides presentation IDs.
 * @returns {HtmlOutput} The search results suitable for display as a sidebar.
 */
function generateSearchResults_(presentationIdsString) {
  const activePresentation = SlidesApp.getActivePresentation();
  const activePresentationId = activePresentation.getId();

  // Get all slides in the active presentation and create a map to track their linking status.
  const allSourceSlidesMap = {}; // Maps slideId to {id, pageNumber, foundLink}
  activePresentation.getSlides().forEach((slide, index) => {
    const slideId = slide.getObjectId();
    const pageNumber = index + 1;
    allSourceSlidesMap[slideId] = {
      id: slideId,
      pageNumber: pageNumber,
      foundLink: false // Flag to track if a link is found
    };
  });

  const displayRows = []; // This will be the final array of rows for the table

  // Parse the input string of presentation IDs.
  const targetPresentationIds = presentationIdsString.split(',')
                                  .map(id => id.trim())
                                  .filter(id => id.length > 0);

  const errors = []; // Stores errors encountered while accessing presentations

  // First, iterate through all target presentations to find linked slides
  for (const targetId of targetPresentationIds) {
    try {
      const targetPresentation = SlidesApp.openById(targetId);
      const targetPresentationName = targetPresentation.getName();
      const targetSlides = targetPresentation.getSlides(); // These are SlidesApp.Slide objects

      for (let index = 0; index < targetSlides.length; index++) {
        const slide = targetSlides[index]; // 'slide' here is a SlidesApp.Slide object

        if (slide.getSlideLinkingMode() === SlidesApp.SlideLinkingMode.LINKED) {
          const linkedSourcePresentationId = slide.getSourcePresentationId();
          const linkedSourceSlideId = slide.getSourceSlideObjectId();

          // Check if the linked slide's source is ANY slide in the active presentation.
          if (linkedSourcePresentationId === activePresentationId && allSourceSlidesMap[linkedSourceSlideId]) {
            allSourceSlidesMap[linkedSourceSlideId].foundLink = true; // Mark as found

            displayRows.push({
              sourceSlidePageNumber: allSourceSlidesMap[linkedSourceSlideId].pageNumber,
              sourceSlideId: linkedSourceSlideId,
              targetPresentationName: targetPresentationName,
              targetPresentationId: targetId,
              targetSlidePageNumber: index + 1, // Slide index is 0-based, convert to 1-based page number
              targetSlideObjectId: slide.getObjectId()
            });
          }
        }
      }
    } catch (e) {
      errors.push(`Could not access presentation ID "${targetId}": ${e.message}`);
      console.error(`Error processing presentation ${targetId}:`, e);
    }
  }

  // Now, add rows for any source slides that were NOT found to be linked in any target presentations.
  for (const slideId in allSourceSlidesMap) {
    if (allSourceSlidesMap.hasOwnProperty(slideId) && !allSourceSlidesMap[slideId].foundLink) {
      displayRows.push({
        sourceSlidePageNumber: allSourceSlidesMap[slideId].pageNumber,
        sourceSlideId: allSourceSlidesMap[slideId].id,
        targetPresentationName: '',
        targetPresentationId: '',
        targetSlidePageNumber: '',
        targetSlideObjectId: ''
      });
    }
  }

  // Determine the title based on whether any linked results were found within displayRows
  const anyLinkedResults = displayRows.some(row => row.targetPresentationId !== '');
  const dialogTitle = anyLinkedResults ? 'Linked Slides Found' : 'No Linked Slides Found';

  const searchTimestamp = new Date().toISOString(); // Generate timestamp for data freshness

  // Create a template for the results HTML and pass data
  const resultTemplate = HtmlService.createTemplateFromFile('LinkedSlidesResults');
  resultTemplate.displayRowsJson = JSON.stringify(displayRows);
  resultTemplate.activePresentationId = activePresentationId;
  resultTemplate.dialogTitle = dialogTitle;
  resultTemplate.searchTimestamp = searchTimestamp;
  resultTemplate.anyLinkedResults = anyLinkedResults;
  resultTemplate.errors = errors;

  // Evaluate the template and display the sidebar
  const resultHtmlOutput = resultTemplate.evaluate()
      .setTitle(dialogTitle);
  return resultHtmlOutput;
}

/**
 * Gets the current slide and selected slides from the active presentation.
 * This function can be called from the client to get up-to-date selection info.
 * @return {Object} An object containing `currentSlideId` and `selectedSlideIds` array.
 */
function _getSelectionInfo() {
  const presentation = SlidesApp.getActivePresentation();
  const selection = presentation.getSelection();
  let selectedSlideIds = [];
  let currentSlideId = null;

  if (selection) {
    const pageRange = selection.getPageRange();
    if (pageRange) {
      selectedSlideIds = pageRange.getPages().map(p => p.getObjectId());
    }
    const currentPage = selection.getCurrentPage();
    if (currentPage) {
      currentSlideId = currentPage.getObjectId();
      // If no slides are selected in the filmstrip, the "current" slide is the selection.
      if (selectedSlideIds.length === 0 && currentSlideId) selectedSlideIds.push(currentSlideId);
    }
  }
  return { currentSlideId, selectedSlideIds };
}

/**
 * Navigates to a specific slide in the active presentation.
 * This function is called from the client-side HTML.
 * @param {string} slideId The object ID of the slide to go to.
 */
function _goToSlide(slideId) {
  try {
    const presentation = SlidesApp.getActivePresentation();
    const slide = presentation.getSlideById(slideId);
    if (slide) {
      slide.selectAsCurrentPage();
    } else {
      console.warn(`_goToSlide: Slide with ID "${slideId}" not found.`);
      SlidesApp.getUi().alert('The slide could not be found. It might have been deleted from the presentation.');
    }
  } catch (e) {
    console.error(`Error in _goToSlide with slideId "${slideId}": ${e.toString()}`);
    SlidesApp.getUi().alert('Could not navigate to the slide. Try right-clicking or Ctrl-clicking on the link and opening it in a new window or tab.');
  }
}

/**
 * Saves the user's selected files to search against for the current presentation.
 * This uses UserProperties, which are scoped to the user and the script, allowing
 * selections (as file IDs) to be remembered for each presentation.
 * @param {string} selectedFileIdsJson A JSON string of an array of file IDs to save.
 */
function _saveSelectedFiles(selectedFileIdsJson) {
  const presentationId = SlidesApp.getActivePresentation().getId();
  const userProperties = PropertiesService.getUserProperties();
  // Create a unique key for this presentation to store its selected files.
  const propertyKey = `linkedSlides.selectedFileIds.${presentationId}`;
  userProperties.setProperty(propertyKey, selectedFileIdsJson);
}

/**
 * Gets the details (id, name, parentName) for a given set of file IDs.
 * This is used to load the most up-to-date file information.
 * @param {string[]} fileIds An array of file IDs.
 * @return {Object[]} An array of file objects, each with {id, name, parentName}.
 *                    Files that are not found or accessible are omitted.
 */
function _getFileDetailsForIds(fileIds) {
  if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
    return [];
  }

  const batchPath = "batch/drive/v3";
  const driveApiBaseUrl = "https://www.googleapis.com/drive/v3";
  const fileRequests = [];

  fileIds.forEach(id => {
    fileRequests.push({
      method: "GET",
      endpoint: `${driveApiBaseUrl}/files/${id}?supportsAllDrives=true&fields=id,name,parents`
    });
  });
  const fileResponses = EDo({
    requests: fileRequests,
    batchPath: batchPath,
  });
  const parentNameMap = {};
  fileResponses.forEach(file => {
    if (file.parents && file.parents.length > 0)
      parentNameMap[file.parents[0]]= 'My Drive';
  });
  const parentRequests = [];
  Object.keys(parentNameMap).forEach(id => {
    parentRequests.push({
      method: "GET",
      endpoint: `${driveApiBaseUrl}/files/${id}?supportsAllDrives=true&fields=id,name`
    });
  });
  const parentResponses = EDo({
    requests: parentRequests,
    batchPath: batchPath,
  });
  parentResponses.forEach(parent => {
    parentNameMap[parent.id] = parent.name;
  });
  const fileDetails = [];
  fileResponses.forEach(file => {
    fileDetails.push({
      id: file.id,
      name: file.name,
      parentName: (file.parents && file.parents.length > 0) ? parentNameMap[file.parents[0]] : 'My Drive'
    });
  });
  return fileDetails;
}
