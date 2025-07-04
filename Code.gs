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
 * This line is intentionally meaningless.
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
      .addItem('Find linked copies of selected slides', 'findLinkedSlides')
      .addToUi();
}

/**
 * Opens a dialog to prompt the user for presentation IDs to search.
 * This function is the entry point for the "Find Linked Slides" menu item.
 * It also passes the OAuth token to the HTML for Picker API authentication.
 */
function findLinkedSlides() {
  const ui = SlidesApp.getUi();
  const activePresentation = SlidesApp.getActivePresentation();
  const selection = activePresentation.getSelection(); // Get the selection object
  let selectedSlides = [];

  if (selection) {
    const pageRange = selection.getPageRange();
    if (pageRange) {
      // If a page range is selected (one or more slides explicitly selected)
      selectedSlides = pageRange.getPages();
    } else {
      // If no page range is selected, try to get the current page (single slide focus)
      const currentPage = selection.getCurrentPage();
      if (currentPage) {
        selectedSlides = [currentPage]; // Use the current page as the selected slide
      }
    }
  }

  // If no slides were found via selection or current page, alert the user.
  if (selectedSlides.length === 0) {
    ui.alert('No Slides Selected', 'Please select one or more slides, or ensure a slide is currently in view, before running this function.', ui.ButtonSet.OK);
    return;
  }

  // Get the OAuth token for the current user. This token is required by the Picker API
  // to authenticate the user and access their Google Drive files.
  const oauthToken = ScriptApp.getOAuthToken();

  // Create a template from the HTML file. This allows us to pass variables
  // (like the OAuth token) from the server-side script to the client-side HTML.
  const template = HtmlService.createTemplateFromFile('PresentationIdInput');
  template.oauthToken = oauthToken; // Pass the token to the template

  // Evaluate the template to get the final HTML output.
  // Set the title, dimensions, and sandbox mode for the dialog.
  const htmlOutput = template.evaluate()
      .setTitle('Find Linked Slides')
      .setWidth(1000) // Increased width to better accommodate the Picker
      .setHeight(600)  // Increased height to better accommodate the Picker
      .setSandboxMode(HtmlService.SandboxMode.IFRAME); // IFRAME mode is recommended for security

  // Display the dialog.
  ui.showModalDialog(htmlOutput, 'Find Linked Slides');
}

/**
 * Performs the search for linked slides based on user input.
 * This function is called by the HTML dialog via google.script.run.
 *
 * @param {string} presentationIdsString A comma-separated string of Google Slides presentation IDs.
 */
function _performLinkedSlideSearch(presentationIdsString) {
  const ui = SlidesApp.getUi();
  const activePresentation = SlidesApp.getActivePresentation();
  const selection = activePresentation.getSelection();
  let selectedPagesFromSelection = [];

  if (selection) {
    const pageRange = selection.getPageRange();
    if (pageRange) {
      selectedPagesFromSelection = pageRange.getPages();
    } else {
      const currentPage = selection.getCurrentPage();
      if (currentPage) {
        selectedPagesFromSelection = [currentPage];
      }
    }
  }

  const activePresentationId = activePresentation.getId();

  // Get all slides in the active presentation (these are SlidesApp.Slide objects).
  const allSlidesInActivePresentation = activePresentation.getSlides();

  // Map to hold selected source slides and track if they've been linked.
  const selectedSourceSlidesMap = {};
  selectedPagesFromSelection.forEach(selectedPage => {
      const slideId = selectedPage.getObjectId();
      const slideIndex = allSlidesInActivePresentation.findIndex(s => s.getObjectId() === slideId);
      if (slideIndex !== -1) {
          const pageNumber = slideIndex + 1;

          selectedSourceSlidesMap[slideId] = {
              id: slideId, // This is the object ID, crucial for the link
              pageNumber: pageNumber,
              foundLink: false // Flag to track if this source slide has been found as linked in any target
          };
      }
  });

  const displayRows = []; // This will be the final array of rows for the table

  // Parse the input string of presentation IDs.
  const targetPresentationIds = presentationIdsString.split(',')
                                  .map(id => id.trim())
                                  .filter(id => id.length > 0);

  if (targetPresentationIds.length === 0) {
    ui.alert('No IDs Entered', 'Please enter at least one presentation ID to search.', ui.ButtonSet.OK);
    return;
  }

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

          // Check if the linked slide's source presentation ID matches the active presentation's ID
          // AND if its source slide ID matches one of the currently selected slides.
          if (linkedSourcePresentationId === activePresentationId && selectedSourceSlidesMap[linkedSourceSlideId]) {
            selectedSourceSlidesMap[linkedSourceSlideId].foundLink = true; // Mark as found

            displayRows.push({
              sourceSlidePageNumber: selectedSourceSlidesMap[linkedSourceSlideId].pageNumber,
              sourceSlideId: selectedSourceSlidesMap[linkedSourceSlideId].id, // Pass the source slide's ID
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

  // Now, add rows for any selected source slides that were NOT found to be linked in any target presentations
  for (const slideId in selectedSourceSlidesMap) {
    if (selectedSourceSlidesMap.hasOwnProperty(slideId) && !selectedSourceSlidesMap[slideId].foundLink) {
      displayRows.push({
        sourceSlidePageNumber: selectedSourceSlidesMap[slideId].pageNumber,
        sourceSlideId: selectedSourceSlidesMap[slideId].id, // Pass the source slide's ID
        targetPresentationName: '', // Empty for unlinked
        targetPresentationId: '',   // Empty for unlinked
        targetSlidePageNumber: '',  // Empty for unlinked
        targetSlideObjectId: ''     // Empty for unlinked
      });
    }
  }

  // Determine the title based on whether any linked results were found within displayRows
  const anyLinkedResults = displayRows.some(row => row.targetPresentationId !== '');
  const dialogTitle = anyLinkedResults ? 'Linked Slides Found' : 'No Linked Slides Found';

  // Create a template for the results HTML and pass data
  const resultTemplate = HtmlService.createTemplateFromFile('LinkedSlidesResults');
  resultTemplate.displayRowsJson = JSON.stringify(displayRows);
  resultTemplate.activePresentationId = activePresentationId;
  resultTemplate.dialogTitle = dialogTitle;
  resultTemplate.anyLinkedResults = anyLinkedResults;
  resultTemplate.errors = errors;

  // Evaluate the template and display the dialog
  const resultHtmlOutput = resultTemplate.evaluate()
      .setTitle('Linked Slides Search Results')
      .setWidth(1000)
      .setHeight(750); // Increased height to prevent clipping

  ui.showModalDialog(resultHtmlOutput, 'Linked Slides Search Results');
}
