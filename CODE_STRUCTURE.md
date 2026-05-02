# Project Structure Overview

jackshitV3/
├── about.html
├── index.html
├── samples.html
├── viewer.html
├── content/
│   ├── contact.html
│   └── home.html
├── geometry/
│   ├── 2_Faces.xml
│   ├── EG.xml
│   ├── EG2.xml
│   ├── FG.xml
│   ├── FMESampleData.xml
│   └── Wilsonville_Ramp.xml
├── pages/
│   └── index.html
├── site/
│   ├── content/
│   │   ├── contact.html
│   │   └── home.html
│   ├── css/
│   │   └── style.css
│   ├── images/
│   │   └── samples/
│   └── js/
│       └── theme.js
├── viewer/
│   ├── css/
│   │   ├── base.css
│   │   ├── collapsible.css
│   │   ├── datatree.css
│   │   ├── panels.css
│   │   ├── settings.css
│   │   ├── statusbar.css
│   │   ├── theme.css
│   │   ├── toolbar.css
│   │   └── upload.css
│   └── js/
│       ├── viewer.js
│       ├── libs/
│       │   └── three.module.js
│       └── modules/
│           ├── crsManager.js
│           ├── dataTree.js
│           ├── fileHandler.js
│           ├── firstPersonControls.js
│           ├── lightsSetup.js
│           ├── parseWorker.js
│           ├── preventSpacebarButtonPress.js
│           ├── sceneData.js
│           ├── settingsManager.js
│           ├── uiController.js
│           ├── uploadHandler.js
│           ├── xmlParser.js
│           └── data transformation/
│               └── XMLtoThree_Surface.js
```

- **Root HTML files**: Main entry points and info pages.
- **content/**: Standalone HTML content.
- **geometry/**: XML geometry data files.
- **pages/**: Additional HTML pages.
- **site/**: Static site assets (content, CSS, images, JS).
- **viewer/**: Viewer app with CSS and JS modules (including Three.js and custom modules).



---

## User File Upload Process

The file upload process in the viewer works as follows:

1. **User Action**: The user clicks the Upload button or drags files onto the data panel in the viewer.
2. **UI Handling**: The upload UI is defined in `viewer.html` and managed by `viewer/js/modules/uploadHandler.js`.
3. **File Validation & Reading**: `uploadHandler.js` checks file type/size, then reads the file (as text or ArrayBuffer).
4. **Event Dispatch**: After reading, a custom `file-uploaded` event is dispatched on the data panel with the file's content and type.
5. **Parsing & Loading**: `viewer/js/modules/fileHandler.js` listens for `file-uploaded` events. It parses the file:
   - **LandXML**: Parsed on the main thread by `xmlParser.js`.
   - **DEM (GeoTIFF/ASC)**: Parsed in a web worker (`parseWorker.js`) to keep the UI responsive.
6. **Scene Update**: Parsed geometry is converted to Three.js meshes and added to the 3D scene for visualization.

**Main modules involved:**
- `viewer/js/modules/uploadHandler.js`: Handles UI, drag-and-drop, file reading, and validation.
- `viewer/js/modules/fileHandler.js`: Receives uploaded files, parses, and loads them into the scene.
- `viewer/js/modules/xmlParser.js`: Parses LandXML files.
- `viewer/js/modules/parseWorker.js`: Parses DEM files (GeoTIFF, ASC) off the main thread.

**Supported file types:** `.xml` (LandXML), `.tif`/`.tiff` (GeoTIFF), `.asc` (ASCII Grid)
