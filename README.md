# Google Slides Linked Slides Add-on (Source Code)

This repository contains the source code for the "Linked Slides Add-on," a Google Apps Script project. This add-on helps users identify linked slides within a Google Slides presentation and across other specified presentations in their Google Drive.

**The primary configuration of this source code is for deployment as a Google Workspace Add-on.** However, instructions are provided below for how to adapt it for manual use as a container-bound Apps Script within a single Google Slides presentation.

## Table of Contents

-   [Features](#features)
-   [Prerequisites](#prerequisites)
-   [Manual Setup and Adaptation for Container-Bound Script](#manual-setup-and-adaptation-for-container-bound-script)
-   [Project Structure](#project-structure)
-   [Contributing](#contributing)
-   [License](#license)

## Features

-   Finds slides linked from the active presentation to other specified presentations.
-   Provides direct links to source and target slides/presentations.
-   Interactive table with sorting and multi-select filtering for results.

## Prerequisites

To use this code manually (either as an add-on or adapted to a container-bound script), you need:

1.  A Google Account.
2.  Access to Google Apps Script.

## Manual Setup and Adaptation for Container-Bound Script

The code in this repository is set up for a Google Workspace Add-on deployment. Follow these steps if you wish to use it manually as a container-bound script within a single Google Slides presentation.

1.  **Open Google Slides Presentation:** Go to [Google Slides](https://docs.google.com/presentation/u/0/) and open the presentation where you want to add this script. If you don't have one, create a new blank presentation.

2.  **Open Apps Script Editor:**
    * In the Google Slides presentation, go to `Extensions` > `Apps Script`.
    * This will open a new Google Apps Script project window, which is "container-bound" to your current presentation.

3.  **Copy `Code.gs` Content:**
    * In the Apps Script editor, you will see a default `Code.gs` file.
    * Delete all the existing content in `Code.gs`.
    * Copy the entire content from the `Code.gs` file in *this GitHub repository* and paste it into your `Code.gs` file in the Apps Script editor.
    * **IMPORTANT ADAPTATION FOR CONTAINER-BOUND SCRIPT:** If you are using this as a container-bound script (not a Workspace Add-on), you will need to modify the `onOpen()` function in `Code.gs`. Change the line:
        ```javascript
        SlidesApp.getUi().createAddonMenu()
        ```
        to:
        ```javascript
        SlidesApp.getUi().createMenu('Linked Slides Add-on')
        ```
        This creates a standard custom menu in your presentation's menu bar instead of an add-on menu.
    * Save the file (File > Save project).

4.  **Create `LinkedSlidesResults.html` File:**
    * In the Apps Script editor, click the `+` icon next to "Files" in the left sidebar.
    * Select `HTML`.
    * Name the new file `LinkedSlidesResults.html`.
    * Copy the entire content from the `LinkedSlidesResults.html` file in *this GitHub repository* and paste it into this new `LinkedSlidesResults.html` file in the Apps Script editor.
    * Save the file.

5.  **Copy `appsscript.json` Manifest Content:**
    * In the Apps Script editor, click the **Project Settings** (gear icon) in the left sidebar.
    * Scroll down to the "Manifest file" section and click the "Edit manifest" button or directly select `appsscript.json` if visible.
    * Delete all the existing content in `appsscript.json`.
    * Copy the entire content from the `appsscript.json` file in *this GitHub repository* and paste it into your `appsscript.json` file in the Apps Script editor.
    * **IMPORTANT ADAPTATION FOR CONTAINER-BOUND SCRIPT:** If you are using this as a container-bound script, you should **remove** the entire `addOns` section from `appsscript.json`. This section is specific to Google Workspace Add-ons.
    * Save the file.

6.  **Refresh Google Slides:**
    * Close the Apps Script editor.
    * Refresh your Google Slides presentation page in your browser.
    * You should now see the custom menu based on your `onOpen()` configuration.

7.  **Authorize Script (First Run):**
    * The very first time you run the script, Google will ask you to authorize it.
    * Click on the menu item: `Extensions` > `Linked Slides Add-on` > `Find linked slides` (or your custom menu if container-bound).
    * Follow the on-screen prompts to grant the necessary permissions. This is a standard security measure for Apps Script.

## Project Structure


```
.
├── .github/
│   └── workflows/
│       └── trigger-private-deploy.yml # Triggers deployment in private repo
├── appsscript.json     # Apps Script manifest file (configured for Add-on)
├── Code.gs             # Google Apps Script server-side code (configured for Add-on)
├── PresentationIdTemplate.html # HTML for the initial dialog/UI (client-side)
├── LinkedSlidesResults.html # HTML for the search results (client-side)
├── CLA.md              # Contributor License Agreement document
└── COPYING             # Full text of the AGPLv3 license
```

## Contributing

We welcome contributions to the Linked Slides Add-on! To ensure a smooth collaboration and proper licensing, all contributors must agree to the terms of our [Contributor License Agreement (CLA)](CLA.md).

### Contributor License Agreement (CLA)

Before your first pull request can be merged, you will need to sign our CLA. This agreement ensures that Green Duck Punch, LLC has the necessary rights to use your contributions in all versions of the add-on, including future commercial releases.

* **How to Sign:** When you submit your first pull request, it will receive a comment from the CLA bot telling you how to sign the CLA.

### Contribution Process

1.  **Fork the repository.**
2.  **Create a new branch** for your feature or bug fix.
3.  **Make your changes** and test them thoroughly.
4.  **Submit a Pull Request** to the `master` branch. When you submit your first pull request, the CLA bot will make a comment telling you how to sign the CLA.

## License

The Google Slides Linked Slides Add-on is dual-licensed:

1.  **[GNU Affero General Public License Version 3 (AGPLv3)](https://www.gnu.org/licenses/agpl-3.0.html):** If you use the add-on or any derivative of its source code (including a container-bound script) under the AGPLv3, you must provide users with access to the corresponding source code under the terms of the AGPLv3.
2.  **Commercial/Proprietary License:** A standard commercial/proprietary license is available for those who would prefer not to be subject to the restrictions of the AGPL. Details of this license are available upon request from Green Duck Punch, LLC.
 
By contributing to this project, you agree to our [Contributor License Agreement](CLA.md) which allows Green Duck Punch, LLC to use your contributions under all licensing models, including future commercial releases. See the agreement for complete details.
