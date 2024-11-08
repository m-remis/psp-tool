import {app, BrowserWindow, dialog, ipcMain, Menu, shell} from 'electron';
import {promises as fs} from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import {ARK4_type, FOLDER_STRUCTURE, folderMap, FolderName} from "./constants/psp_folder_constants";
import {INSTANCE_WINDOW_MIN_HEIGHT, INSTANCE_WINDOW_MIN_WIDTH, MENU_CONTENT} from "./constants/app_constants";

let mainWindow: BrowserWindow | null;

if (!app.requestSingleInstanceLock()) {
    console.debug("Main - Another instance is already running");
    app.quit();
} else {
    app.on('second-instance', () => handleSecondInstance());
    app.on('window-all-closed', handleAllWindowsClosed);
    app.on('activate', handleAppActivate);
    app.whenReady().then(createMainWindow);
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: INSTANCE_WINDOW_MIN_WIDTH,
        height: INSTANCE_WINDOW_MIN_HEIGHT,
        minWidth: INSTANCE_WINDOW_MIN_WIDTH,
        minHeight: INSTANCE_WINDOW_MIN_HEIGHT,
        resizable: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '/preload.js')
        }
    });

    Menu.setApplicationMenu(Menu.buildFromTemplate(MENU_CONTENT));
    mainWindow.loadFile(path.join(__dirname, '/renderer/index.html'));
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function handleSecondInstance() {
    console.debug("Main - Second instance detected");
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
}

function handleAllWindowsClosed() {
    console.debug("Main - Closing all windows");
    if (process.platform !== 'darwin') app.quit();
}

function handleAppActivate() {
    console.debug("Main - Activate");
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
}

ipcMain.handle('dialog:selectMemoryCardRoot', handleSelectCardRoot);
ipcMain.handle('folder:createMissingFiles', handleCreateAllMissingFiles);
ipcMain.handle('folder:isEmpty', handleIsFolderEmpty);
ipcMain.handle('dialog:transferUpdate', handleTransferUpdate);
ipcMain.handle('dialog:openTargetDirectory', handleOpenTargetDirectory);
ipcMain.handle('dialog:extractArk4', handleExtractArk4);
ipcMain.handle('dialog:extractChronoswitch', handleExtractChronoswitch);
ipcMain.handle('dialog:extractSaveFiles', extractSaveFiles);
ipcMain.handle('dialog:backupSaveFiles', backupSaveFiles);

async function handleSelectCardRoot() {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            filters: [{name: 'All Files', extensions: ['*']}]
        });
        return result.filePaths[0] || null;
    } catch (error) {
        console.error("Error opening file dialog:", error);
        return null;
    }
}

async function handleCreateAllMissingFiles(_event: any, directoryPath: string) {
    try {
        await createFolderStructure(directoryPath);
        return `Folder structure created at: ${directoryPath}`;
    } catch (error) {
        console.error("Error creating folder structure:", error);
        return "Failed to create folder structure";
    }
}

async function handleIsFolderEmpty(_event: any, directoryPath: string, folderName: FolderName): Promise<boolean> {
    let targetDir = directoryPath;
    if (folderName) {
        targetDir = path.join(targetDir, folderMap[folderName])
    }
    try {
        const files = await fs.readdir(targetDir);
        return files.length === 0;
    } catch (error) {
        console.error("Error checking if directory is empty:", error);
        throw new Error('Could not check directory contents.');
    }
}

async function handleTransferUpdate(_event: any, directoryPath: string) {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{name: 'PBP Files', extensions: ['pbp']}]
        });
        if (result.canceled) return "Cancelled";

        const selectedFilePath = result.filePaths[0];
        const destinationPath = path.join(directoryPath, folderMap["update"], 'EBOOT.PBP');

        await fs.mkdir(path.dirname(destinationPath), {recursive: true});
        await fs.copyFile(selectedFilePath, destinationPath);
        return "Transferred";
    } catch (error) {
        console.error("Error transferring update file:", error);
        return "Failed to copy file";
    }
}

async function handleOpenTargetDirectory(_event: any, directoryPath: string, targetFolder: FolderName | null) {
    console.debug("Main - open target dir")
    let targetDir = directoryPath;
    if (targetFolder) {
        targetDir = path.join(targetDir, folderMap[targetFolder])
    }

    try {
        await fs.stat(targetDir);
        await shell.openPath(targetDir);
        return true;
    } catch (error) {
        console.error("Error opening directory:", error);
        return false;
    }
}

async function handleExtractArk4(_event: any, directoryPath: string, type: ARK4_type) {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{name: 'ZIP Files', extensions: ['zip']}]
        });
        if (result.canceled) return "Cancelled";

        const selectedFilePath = result.filePaths[0];
        if (path.basename(selectedFilePath) !== 'ARK4.zip') return "Invalid file selected. Please select 'ARK4.zip'.";

        const zip = new AdmZip(selectedFilePath);
        await extractArkFolders(zip, directoryPath, type);
        return "Extracted";
    } catch (error) {
        console.error("Error extracting ARK4.zip:", error);
        return "Failed to extract folders.";
    }
}

async function handleExtractChronoswitch(_event: any, directoryPath: string) {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{name: 'ZIP Files', extensions: ['zip']}]
        });
        if (result.canceled) return "Cancelled";

        const selectedFilePath = result.filePaths[0];
        if (!/^ChronoSwitch_v[\d.]+\.zip$/.test(path.basename(selectedFilePath))) {
            return "Invalid file selected. Please select a file named 'ChronoSwitch_vX.X.zip'.";
        }

        const zip = new AdmZip(selectedFilePath);
        await extractChronoswitchFolders(zip, directoryPath);
        return "Extracted";
    } catch (error) {
        console.error("Error extracting ChronoSwitch_vX.X.zip", error);
        return "Failed to extract folders.";
    }
}

async function createFolderStructure(basePath: string) {
    console.debug("Main - Creating folder structure as needed");
    try {
        for (const folder of FOLDER_STRUCTURE) {
            const folderPath = path.join(basePath, folder);

            try {
                await fs.access(folderPath);
                console.debug(`Main - Directory already exists: ${folderPath}`);
            } catch {
                await fs.mkdir(folderPath, {recursive: true});
                console.debug(`Main - Created missing directory: ${folderPath}`);
            }
        }
        console.debug('Main - Folder structure checked and missing folders created successfully.');
    } catch (error) {
        console.error('Main - Error while creating folder structure:', error);
        throw new Error('Failed to ensure folder structure.');
    }
}

async function extractArkFolders(zip: AdmZip, directoryPath: string, type: ARK4_type) {
    console.debug(`Extracting ARK4 type: ${type}`)
    await fs.mkdir(path.join(directoryPath, folderMap["psp_game"]), {recursive: true});
    if (type === "temp") {
        await fs.mkdir(path.join(directoryPath, folderMap["saveFiles"]), {recursive: true});
        zip.extractEntryTo('ARK_01234/', path.join(directoryPath, folderMap["saveFiles"]), true, true);
        zip.extractEntryTo('ARK_Loader/', path.join(directoryPath, folderMap["psp_game"]), true, true);
        return;
    }
    if (type === "cIPL") {
        zip.extractEntryTo('PSP/ARK_cIPL/', path.join(directoryPath, folderMap["psp_game"], "ARK_cIPL"), false, true);
        return;
    }
    if (type === "full") {
        zip.extractEntryTo('PSP/ARK_Full_Installer/', path.join(directoryPath, folderMap["psp_game"], "ARK_Full_Installer"), false, true);
        return;
    }
    if (type === "update") {
        zip.extractEntryTo('UPDATE/', path.join(directoryPath, folderMap["psp_game"]), true, true);
    }
}

async function extractChronoswitchFolders(zip: AdmZip, directoryPath: string) {
    await fs.mkdir(path.join(directoryPath, 'PSP', 'GAME', 'Chronoswitch'), {recursive: true});
    const sourcePath = 'PSP/GAME/ChronoSwitch/';
    const destinationPath = path.join(directoryPath, folderMap["psp_game"], 'Chronoswitch');
    zip.extractEntryTo(sourcePath, destinationPath, false, true);
}

async function backupSaveFiles(_event: any, directoryPath: string) {
    try {
        const result = await dialog.showSaveDialog({
            filters: [{name: 'Zip Files', extensions: ['zip']}]
        });

        if (result.canceled) return "Cancelled";

        const zipFilePath = result.filePath;

        const zip = new AdmZip();
        const saveFilesPath = path.join(directoryPath, folderMap["saveFiles"]);

        zip.addLocalFolder(saveFilesPath, "");

        zip.writeZip(zipFilePath);

        return `Backup created successfully at: ${zipFilePath}`;
    } catch (error) {
        console.error("Error backing up save files:", error);
        return "Failed to backup save files.";
    }
}

async function extractSaveFiles(_event: any, directoryPath: string) {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{name: 'Zip Files', extensions: ['zip']}]
        });

        if (result.canceled) return "Cancelled";

        const zipFilePath = result.filePaths[0];

        const zip = new AdmZip(zipFilePath);

        const saveFilesPath = path.join(directoryPath, folderMap["saveFiles"]);
        zip.extractAllTo(saveFilesPath, true);

        return "Save files extracted successfully.";
    } catch (error) {
        console.error("Error extracting save files:", error);
        return "Failed to extract save files.";
    }
}
