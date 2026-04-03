import { memo, useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import { useTerminalStore } from "../../store/terminalStore";
import {
  getBuildCommand,
  getRunCommand,
  getTestCommand,
} from "../../utils/languageRunner";
import { dispatchEditorWorkbenchAction } from "../../utils/workbenchActions";

type MenuEntry = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  submenu?: MenuEntry[];
  onSelect?: () => void | Promise<void>;
};

type RootMenu = {
  id: string;
  label: string;
  items: MenuEntry[];
};

function relativeToWorkspace(filePath: string, workspacePath: string | null) {
  if (!workspacePath) return filePath;
  const normalizedFile = filePath.replace(/\\/g, "/");
  const normalizedWorkspace = workspacePath.replace(/\\/g, "/");
  if (!normalizedFile.startsWith(normalizedWorkspace)) return filePath;
  return normalizedFile.replace(normalizedWorkspace, "").replace(/^\/+/, "");
}

export const MenuBar = memo(function MenuBar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [openPath, setOpenPath] = useState<string[]>([]);

  const {
    tabs,
    activeTabId,
    openFolder,
    recentFiles,
    openFile,
    closeTab,
    closeAllTabs,
    setActiveTab,
    saveFile,
    saveFileAs,
    saveAllFiles,
    revertFile,
    setOpenFolder,
  } = useEditorStore();
  const {
    activeView,
    showActivityBar,
    showSidebar,
    showStatusBar,
    showTerminal,
    showAIPanel,
    showCommandCenter,
    showCommandPalette,
    showQuickOpen,
    colorTheme,
    iconTheme,
    wordWrap,
    autoSave,
    columnSelectionMode,
    multiCursorModifier,
    openView,
    toggleActivityBar,
    toggleSidebar,
    toggleStatusBar,
    toggleTerminal,
    toggleAIPanel,
    toggleCommandCenter,
    toggleCommandPalette,
    toggleSettingsPanel,
    toggleQuickOpen,
    setColorTheme,
    setIconTheme,
    setWordWrap,
    setAutoSave,
    toggleColumnSelectionMode,
    toggleMultiCursorModifier,
    addToast,
  } = useUIStore();
  const { setOpenFolder: setAIOpenFolder } = useAIStore();
  const {
    showAndRunCommand,
    showTerminalTab,
    requestNewTerminal,
    requestSplitTerminal,
    requestClearTerminal,
    requestCloseActiveTerminal,
    lastErrors,
  } = useTerminalStore();

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeIndex = activeTabId ? tabs.findIndex((tab) => tab.id === activeTabId) : -1;
  const workspaceName = openFolder?.split(/[\\/]/).pop() || "workspace";

  const runCmd = activeTab ? getRunCommand(activeTab.language, activeTab.filePath, activeTab.fileName) : null;
  const buildCmd = activeTab ? getBuildCommand(activeTab.language, activeTab.filePath, activeTab.fileName) : null;
  const testCmd = activeTab ? getTestCommand(activeTab.language, activeTab.filePath, activeTab.fileName) : null;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpenPath([]);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPath([]);
    };

    const handleBlur = () => {
      setOpenPath([]);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const closeMenus = () => setOpenPath([]);

  const runLeafAction = async (entry: MenuEntry) => {
    if (!entry.onSelect || entry.disabled) return;
    await entry.onSelect();
    closeMenus();
  };

  const ensureTerminalVisible = (tab: "terminal" | "problems" | "run" | "output" = "terminal") => {
    showTerminalTab(tab);
  };

  const queueCommand = (command: string | null, missingMessage: string) => {
    if (!command) {
      addToast(missingMessage, "warning");
      return;
    }

    showAndRunCommand(command);
  };

  const copyToClipboard = async (value: string, successLabel: string) => {
    try {
      await navigator.clipboard.writeText(value);
      addToast(successLabel, "success");
    } catch (error) {
      console.error("Clipboard write failed:", error);
      addToast("Clipboard access failed.", "error");
    }
  };

  const openFileDialog = async () => {
    const selected = await open({ directory: false, multiple: false });
    if (typeof selected !== "string") return;
    await openFile(selected);
  };

  const openFolderDialog = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    setOpenFolder(selected);
    setAIOpenFolder(selected);
    openView("explorer");
  };

  const newTextFile = async () => {
    useEditorStore.getState().createUntitledTab();
  };

  const newFileFromPrompt = async () => {
    if (!openFolder) {
      addToast("Open a folder first to create files.", "warning");
      return;
    }

    const fileName = prompt("New file name:");
    if (!fileName) return;

    const targetPath = `${openFolder}/${fileName}`;
    await invoke("create_file", { path: targetPath, isDir: false });
    await openFile(targetPath);
  };

  const saveActiveFile = async () => {
    if (!activeTab) return;
    if (activeTab.filePath.startsWith("untitled:")) {
      await saveActiveFileAs();
      return;
    }
    await saveFile(activeTab.id);
  };

  const saveActiveFileAs = async () => {
    if (!activeTab) return;
    const targetPath = await save({
      defaultPath: activeTab.fileName,
    });
    if (!targetPath) return;
    await saveFileAs(activeTab.id, targetPath);
  };

  const saveWorkspaceAs = async () => {
    if (!openFolder) {
      addToast("Open a folder first to save a workspace file.", "warning");
      return;
    }

    const targetPath = await save({
      defaultPath: `${workspaceName}.code-workspace`,
      filters: [{ name: "VS Code Workspace", extensions: ["code-workspace"] }],
    });
    if (!targetPath) return;

    const content = JSON.stringify(
      {
        folders: [{ path: openFolder }],
        settings: {
          "workbench.colorTheme": colorTheme,
          "workbench.iconTheme": iconTheme,
        },
      },
      null,
      2
    );

    await invoke("write_file", { path: targetPath, content });
    addToast("Workspace file saved.", "success");
  };

  const closeFolder = () => {
    closeAllTabs();
    setOpenFolder(null);
    setAIOpenFolder(null);
    addToast("Folder closed.", "info");
  };

  const openCommandPalette = () => {
    if (showQuickOpen) toggleQuickOpen();
    if (!showCommandPalette) toggleCommandPalette();
  };

  const openQuickOpen = () => {
    if (showCommandPalette) toggleCommandPalette();
    if (!showQuickOpen) toggleQuickOpen();
  };

  const preferencesMenu: MenuEntry[] = [
    {
      id: "preferences-settings",
      label: "Settings",
      shortcut: "Ctrl+,",
      onSelect: () => toggleSettingsPanel(),
    },
    {
      id: "preferences-color-theme",
      label: "Color Theme",
      submenu: [
        {
          id: "theme-dark",
          label: "Dark+",
          checked: colorTheme === "dark",
          onSelect: () => setColorTheme("dark"),
        },
        {
          id: "theme-github",
          label: "GitHub Dark",
          checked: colorTheme === "github",
          onSelect: () => setColorTheme("github"),
        },
        {
          id: "theme-dracula",
          label: "Dracula",
          checked: colorTheme === "dracula",
          onSelect: () => setColorTheme("dracula"),
        },
      ],
    },
    {
      id: "preferences-icon-theme",
      label: "File Icon Theme",
      submenu: [
        {
          id: "icons-default",
          label: "Default",
          checked: iconTheme === "default",
          onSelect: () => setIconTheme("default"),
        },
        {
          id: "icons-noto",
          label: "Noto Icons",
          checked: iconTheme === "noto",
          onSelect: () => setIconTheme("noto"),
        },
        {
          id: "icons-simple",
          label: "Simple Icons",
          checked: iconTheme === "simple",
          onSelect: () => setIconTheme("simple"),
        },
      ],
    },
    {
      id: "preferences-keybindings",
      label: "Keyboard Shortcuts",
      onSelect: () => openView("keybindings"),
    },
  ];

  const appearanceMenu: MenuEntry[] = [
    {
      id: "appearance-command-center",
      label: "Command Center",
      checked: showCommandCenter,
      onSelect: () => toggleCommandCenter(),
    },
    {
      id: "appearance-activity-bar",
      label: "Activity Bar",
      checked: showActivityBar,
      onSelect: () => toggleActivityBar(),
    },
    {
      id: "appearance-sidebar",
      label: "Primary Side Bar",
      shortcut: "Ctrl+B",
      checked: showSidebar,
      onSelect: () => toggleSidebar(),
    },
    {
      id: "appearance-secondary-sidebar",
      label: "Secondary Side Bar",
      checked: showAIPanel,
      onSelect: () => toggleAIPanel(),
    },
    {
      id: "appearance-panel",
      label: "Panel",
      shortcut: "Ctrl+`",
      checked: showTerminal,
      onSelect: () => toggleTerminal(),
    },
    {
      id: "appearance-status-bar",
      label: "Status Bar",
      checked: showStatusBar,
      onSelect: () => toggleStatusBar(),
    },
    {
      id: "appearance-menu-bar",
      label: "Menu Bar",
      checked: true,
      disabled: true,
    },
  ];

  const editorLayoutMenu: MenuEntry[] = [
    { id: "layout-split-up", label: "Split Up", disabled: true },
    { id: "layout-split-down", label: "Split Down", disabled: true },
    { id: "layout-split-left", label: "Split Left", disabled: true },
    { id: "layout-split-right", label: "Split Right", disabled: true },
    {
      id: "layout-reset",
      label: "Reset Layout",
      onSelect: () => {
        if (!showSidebar) toggleSidebar();
        if (!showActivityBar) toggleActivityBar();
        if (!showStatusBar) toggleStatusBar();
        if (!showCommandCenter) toggleCommandCenter();
      },
    },
  ];

  const switchEditorSubmenu = tabs.length
    ? tabs.map<MenuEntry>((tab) => ({
        id: `switch-editor-${tab.id}`,
        label: tab.fileName,
        checked: tab.id === activeTabId,
        onSelect: () => setActiveTab(tab.id),
      }))
    : [{ id: "switch-editor-empty", label: "No Open Editors", disabled: true }];

  const openRecentSubmenu = recentFiles.length
    ? recentFiles.slice(0, 10).map<MenuEntry>((filePath) => ({
        id: `recent-${filePath}`,
        label: filePath.split(/[\\/]/).pop() || filePath,
        shortcut: relativeToWorkspace(filePath, openFolder),
        onSelect: async () => {
          await openFile(filePath);
        },
      }))
    : [{ id: "recent-empty", label: "No Recent Files", disabled: true }];

  const shareSubmenu: MenuEntry[] = [
    {
      id: "share-file-path",
      label: "Copy File Path",
      disabled: !activeTab,
      onSelect: async () => {
        if (!activeTab) return;
        await copyToClipboard(activeTab.filePath, "Copied file path.");
      },
    },
    {
      id: "share-relative-path",
      label: "Copy Relative Path",
      disabled: !activeTab,
      onSelect: async () => {
        if (!activeTab) return;
        await copyToClipboard(relativeToWorkspace(activeTab.filePath, openFolder), "Copied relative path.");
      },
    },
    {
      id: "share-workspace-path",
      label: "Copy Workspace Path",
      disabled: !openFolder,
      onSelect: async () => {
        if (!openFolder) return;
        await copyToClipboard(openFolder, "Copied workspace path.");
      },
    },
  ];

  const rootMenus: RootMenu[] = [
      {
        id: "file",
        label: "File",
        items: [
          { id: "file-new-text", label: "New Text File", shortcut: "Ctrl+N", onSelect: newTextFile },
          { id: "file-new-file", label: "New File...", shortcut: "Ctrl+Alt+Super+N", onSelect: newFileFromPrompt },
          { id: "file-new-window", label: "New Window", shortcut: "Ctrl+Shift+N", disabled: true },
          {
            id: "file-new-window-profile",
            label: "New Window with Profile",
            submenu: [
              { id: "profile-default", label: "Default", disabled: true },
              { id: "profile-minimal", label: "Minimal", disabled: true },
            ],
          },
          { id: "file-sep-1", label: "", disabled: true },
          { id: "file-open-file", label: "Open File...", shortcut: "Ctrl+O", onSelect: openFileDialog },
          { id: "file-open-folder", label: "Open Folder...", shortcut: "Ctrl+K Ctrl+O", onSelect: openFolderDialog },
          {
            id: "file-open-workspace",
            label: "Open Workspace from File...",
            onSelect: async () => {
              const selected = await open({
                directory: false,
                multiple: false,
                filters: [{ name: "VS Code Workspace", extensions: ["code-workspace"] }],
              });
              if (typeof selected !== "string") return;
              await openFile(selected);
            },
          },
          { id: "file-open-recent", label: "Open Recent", submenu: openRecentSubmenu },
          { id: "file-sep-2", label: "", disabled: true },
          {
            id: "file-add-folder",
            label: "Add Folder to Workspace...",
            onSelect: async () => {
              await openFolderDialog();
              addToast("Single-folder workspace replaced with the selected folder.", "info");
            },
          },
          {
            id: "file-save-workspace",
            label: "Save Workspace As...",
            disabled: !openFolder,
            onSelect: saveWorkspaceAs,
          },
          { id: "file-duplicate-workspace", label: "Duplicate Workspace", disabled: true },
          { id: "file-sep-3", label: "", disabled: true },
          {
            id: "file-save",
            label: "Save",
            shortcut: "Ctrl+S",
            disabled: !activeTab,
            onSelect: saveActiveFile,
          },
          {
            id: "file-save-as",
            label: "Save As...",
            shortcut: "Ctrl+Shift+S",
            disabled: !activeTab,
            onSelect: saveActiveFileAs,
          },
          {
            id: "file-save-all",
            label: "Save All",
            disabled: tabs.length === 0,
            onSelect: async () => {
              await saveAllFiles();
            },
          },
          { id: "file-sep-4", label: "", disabled: true },
          { id: "file-share", label: "Share", submenu: shareSubmenu },
          {
            id: "file-auto-save",
            label: "Auto Save",
            checked: autoSave,
            onSelect: () => setAutoSave(!autoSave),
          },
          { id: "file-preferences", label: "Preferences", submenu: preferencesMenu },
          { id: "file-sep-5", label: "", disabled: true },
          {
            id: "file-revert",
            label: "Revert File",
            disabled: !activeTab || !activeTab.isDirty,
            onSelect: async () => {
              if (!activeTab) return;
              await revertFile(activeTab.id);
            },
          },
          {
            id: "file-close-editor",
            label: "Close Editor",
            shortcut: "Ctrl+W",
            disabled: !activeTab,
            onSelect: () => {
              if (activeTab) closeTab(activeTab.id);
            },
          },
          {
            id: "file-close-folder",
            label: "Close Folder",
            disabled: !openFolder,
            onSelect: closeFolder,
          },
          {
            id: "file-close-window",
            label: "Close Window",
            shortcut: "Alt+F4",
            onSelect: () => window.close(),
          },
          {
            id: "file-exit",
            label: "Exit",
            shortcut: "Ctrl+Q",
            onSelect: () => window.close(),
          },
        ],
      },
      {
        id: "edit",
        label: "Edit",
        items: [
          { id: "edit-undo", label: "Undo", shortcut: "Ctrl+Z", onSelect: () => dispatchEditorWorkbenchAction("undo") },
          { id: "edit-redo", label: "Redo", shortcut: "Ctrl+Y", onSelect: () => dispatchEditorWorkbenchAction("redo") },
          { id: "edit-sep-1", label: "", disabled: true },
          { id: "edit-cut", label: "Cut", shortcut: "Ctrl+X", onSelect: () => dispatchEditorWorkbenchAction("cut") },
          { id: "edit-copy", label: "Copy", shortcut: "Ctrl+C", onSelect: () => dispatchEditorWorkbenchAction("copy") },
          { id: "edit-paste", label: "Paste", shortcut: "Ctrl+V", onSelect: () => dispatchEditorWorkbenchAction("paste") },
          { id: "edit-sep-2", label: "", disabled: true },
          { id: "edit-find", label: "Find", shortcut: "Ctrl+F", onSelect: () => dispatchEditorWorkbenchAction("find") },
          { id: "edit-replace", label: "Replace", shortcut: "Ctrl+H", onSelect: () => dispatchEditorWorkbenchAction("replace") },
          { id: "edit-find-files", label: "Find in Files", shortcut: "Ctrl+Shift+F", onSelect: () => openView("search") },
          { id: "edit-replace-files", label: "Replace in Files", shortcut: "Ctrl+Shift+H", onSelect: () => openView("search-replace") },
          { id: "edit-sep-3", label: "", disabled: true },
          {
            id: "edit-comment-line",
            label: "Toggle Line Comment",
            shortcut: "Ctrl+/",
            onSelect: () => dispatchEditorWorkbenchAction("toggleLineComment"),
          },
          {
            id: "edit-comment-block",
            label: "Toggle Block Comment",
            shortcut: "Ctrl+Shift+Alt+A",
            onSelect: () => dispatchEditorWorkbenchAction("toggleBlockComment"),
          },
          {
            id: "edit-emmet-expand",
            label: "Emmet: Expand Abbreviation",
            shortcut: "Tab",
            onSelect: () => dispatchEditorWorkbenchAction("emmetExpand"),
          },
        ],
      },
      {
        id: "selection",
        label: "Selection",
        items: [
          { id: "selection-all", label: "Select All", shortcut: "Ctrl+A", onSelect: () => dispatchEditorWorkbenchAction("selectAll") },
          {
            id: "selection-expand",
            label: "Expand Selection",
            shortcut: "Shift+Alt+RightArrow",
            onSelect: () => dispatchEditorWorkbenchAction("expandSelection"),
          },
          {
            id: "selection-shrink",
            label: "Shrink Selection",
            shortcut: "Shift+Alt+LeftArrow",
            onSelect: () => dispatchEditorWorkbenchAction("shrinkSelection"),
          },
          { id: "selection-sep-1", label: "", disabled: true },
          {
            id: "selection-copy-line-up",
            label: "Copy Line Up",
            shortcut: "Ctrl+Shift+Alt+UpArrow",
            onSelect: () => dispatchEditorWorkbenchAction("copyLineUp"),
          },
          {
            id: "selection-copy-line-down",
            label: "Copy Line Down",
            shortcut: "Ctrl+Shift+Alt+DownArrow",
            onSelect: () => dispatchEditorWorkbenchAction("copyLineDown"),
          },
          {
            id: "selection-move-line-up",
            label: "Move Line Up",
            shortcut: "Alt+UpArrow",
            onSelect: () => dispatchEditorWorkbenchAction("moveLineUp"),
          },
          {
            id: "selection-move-line-down",
            label: "Move Line Down",
            shortcut: "Alt+DownArrow",
            onSelect: () => dispatchEditorWorkbenchAction("moveLineDown"),
          },
          {
            id: "selection-duplicate",
            label: "Duplicate Selection",
            shortcut: "Shift+Alt+DownArrow",
            onSelect: () => dispatchEditorWorkbenchAction("copyLineDown"),
          },
          { id: "selection-sep-2", label: "", disabled: true },
          {
            id: "selection-cursor-above",
            label: "Add Cursor Above",
            shortcut: "Shift+Alt+UpArrow",
            onSelect: () => dispatchEditorWorkbenchAction("addCursorAbove"),
          },
          {
            id: "selection-cursor-below",
            label: "Add Cursor Below",
            shortcut: "Shift+Alt+DownArrow",
            onSelect: () => dispatchEditorWorkbenchAction("addCursorBelow"),
          },
          {
            id: "selection-cursor-ends",
            label: "Add Cursors to Line Ends",
            shortcut: "Shift+Alt+I",
            onSelect: () => dispatchEditorWorkbenchAction("addCursorsToLineEnds"),
          },
          {
            id: "selection-next-occurrence",
            label: "Add Next Occurrence",
            shortcut: "Ctrl+D",
            onSelect: () => dispatchEditorWorkbenchAction("addNextOccurrence"),
          },
          {
            id: "selection-previous-occurrence",
            label: "Add Previous Occurrence",
            onSelect: () => dispatchEditorWorkbenchAction("addPreviousOccurrence"),
          },
          {
            id: "selection-all-occurrences",
            label: "Select All Occurrences",
            shortcut: "Ctrl+Shift+L",
            onSelect: () => dispatchEditorWorkbenchAction("selectAllOccurrences"),
          },
          { id: "selection-sep-3", label: "", disabled: true },
          {
            id: "selection-ctrl-click",
            label: "Switch to Ctrl+Click for Multi-Cursor",
            checked: multiCursorModifier === "ctrlCmd",
            onSelect: () => toggleMultiCursorModifier(),
          },
          {
            id: "selection-column-mode",
            label: "Column Selection Mode",
            checked: columnSelectionMode,
            onSelect: () => toggleColumnSelectionMode(),
          },
        ],
      },
      {
        id: "view",
        label: "View",
        items: [
          {
            id: "view-command-palette",
            label: "Command Palette...",
            shortcut: "Ctrl+Shift+P",
            onSelect: () => openCommandPalette(),
          },
          {
            id: "view-open-view",
            label: "Open View...",
            onSelect: () => openCommandPalette(),
          },
          { id: "view-sep-1", label: "", disabled: true },
          { id: "view-appearance", label: "Appearance", submenu: appearanceMenu },
          { id: "view-layout", label: "Editor Layout", submenu: editorLayoutMenu },
          { id: "view-sep-2", label: "", disabled: true },
          { id: "view-explorer", label: "Explorer", shortcut: "Ctrl+Shift+E", checked: activeView === "explorer" && showSidebar, onSelect: () => openView("explorer") },
          { id: "view-search", label: "Search", shortcut: "Ctrl+Shift+F", checked: activeView === "search" && showSidebar, onSelect: () => openView("search") },
          { id: "view-source-control", label: "Source Control", shortcut: "Ctrl+Shift+G", checked: activeView === "git" && showSidebar, onSelect: () => openView("git") },
          { id: "view-run", label: "Run", shortcut: "Ctrl+Shift+D", checked: activeView === "tasks" && showSidebar, onSelect: () => openView("tasks") },
          { id: "view-extensions", label: "Extensions", shortcut: "Ctrl+Shift+X", checked: activeView === "extensions" && showSidebar, onSelect: () => openView("extensions") },
          { id: "view-sep-3", label: "", disabled: true },
          { id: "view-chat", label: "Chat", shortcut: "Ctrl+Alt+I", checked: showAIPanel, onSelect: () => toggleAIPanel() },
          { id: "view-sep-4", label: "", disabled: true },
          {
            id: "view-problems",
            label: "Problems",
            shortcut: "Ctrl+Shift+M",
            onSelect: () => {
              ensureTerminalVisible("problems");
              if (lastErrors.length === 0) addToast("No current problems in terminal diagnostics.", "info");
            },
          },
          { id: "view-output", label: "Output", shortcut: "Ctrl+K Ctrl+H", onSelect: () => ensureTerminalVisible("output") },
          { id: "view-debug-console", label: "Debug Console", shortcut: "Ctrl+Shift+Y", onSelect: () => ensureTerminalVisible("output") },
          { id: "view-terminal", label: "Terminal", shortcut: "Ctrl+`", checked: showTerminal, onSelect: () => toggleTerminal() },
          { id: "view-sep-5", label: "", disabled: true },
          { id: "view-word-wrap", label: "Word Wrap", shortcut: "Alt+Z", checked: wordWrap, onSelect: () => setWordWrap(!wordWrap) },
        ],
      },
      {
        id: "go",
        label: "Go",
        items: [
          {
            id: "go-back",
            label: "Back",
            shortcut: "Ctrl+Alt+-",
            disabled: activeIndex <= 0,
            onSelect: () => {
              if (activeIndex > 0) setActiveTab(tabs[activeIndex - 1].id);
            },
          },
          {
            id: "go-forward",
            label: "Forward",
            shortcut: "Ctrl+Shift+-",
            disabled: activeIndex < 0 || activeIndex >= tabs.length - 1,
            onSelect: () => {
              if (activeIndex >= 0 && activeIndex < tabs.length - 1) setActiveTab(tabs[activeIndex + 1].id);
            },
          },
          { id: "go-last-edit", label: "Last Edit Location", shortcut: "Ctrl+K Ctrl+Q", disabled: true },
          { id: "go-sep-1", label: "", disabled: true },
          { id: "go-switch-editor", label: "Switch Editor", submenu: switchEditorSubmenu },
          {
            id: "go-switch-group",
            label: "Switch Group",
            submenu: [
              { id: "go-group-1", label: "Editor Group 1", checked: true, disabled: true },
              { id: "go-group-next", label: "Next Group", disabled: true },
            ],
          },
          { id: "go-sep-2", label: "", disabled: true },
          { id: "go-file", label: "Go to File...", shortcut: "Ctrl+P", onSelect: () => openQuickOpen() },
          { id: "go-symbol-workspace", label: "Go to Symbol in Workspace...", shortcut: "Ctrl+T", onSelect: () => openView("symbols") },
          { id: "go-symbol-editor", label: "Go to Symbol in Editor...", shortcut: "Ctrl+Shift+O", onSelect: () => dispatchEditorWorkbenchAction("quickOutline") },
          { id: "go-definition", label: "Go to Definition", shortcut: "F12", onSelect: () => dispatchEditorWorkbenchAction("goToDefinition") },
          { id: "go-declaration", label: "Go to Declaration", onSelect: () => dispatchEditorWorkbenchAction("goToDeclaration") },
          { id: "go-type-definition", label: "Go to Type Definition", onSelect: () => dispatchEditorWorkbenchAction("goToTypeDefinition") },
          { id: "go-implementation", label: "Go to Implementations", shortcut: "Ctrl+F12", onSelect: () => dispatchEditorWorkbenchAction("goToImplementation") },
          { id: "go-references", label: "Go to References", shortcut: "Shift+F12", onSelect: () => dispatchEditorWorkbenchAction("goToReferences") },
          { id: "go-line", label: "Go to Line/Column...", shortcut: "Ctrl+G", onSelect: () => dispatchEditorWorkbenchAction("goToLine") },
          { id: "go-bracket", label: "Go to Bracket", shortcut: "Ctrl+Shift+\\", onSelect: () => dispatchEditorWorkbenchAction("goToBracket") },
          { id: "go-sep-3", label: "", disabled: true },
          { id: "go-next-problem", label: "Next Problem", shortcut: "F8", onSelect: () => dispatchEditorWorkbenchAction("nextProblem") },
          { id: "go-prev-problem", label: "Previous Problem", shortcut: "Shift+F8", onSelect: () => dispatchEditorWorkbenchAction("previousProblem") },
          { id: "go-next-change", label: "Next Change", shortcut: "Alt+F3", disabled: true },
          { id: "go-prev-change", label: "Previous Change", shortcut: "Shift+Alt+F3", disabled: true },
        ],
      },
      {
        id: "more",
        label: "...",
        items: [
          {
            id: "more-run",
            label: "Run",
            submenu: [
              {
                id: "run-start",
                label: "Start Debugging",
                shortcut: "F5",
                disabled: !runCmd,
                onSelect: () => queueCommand(runCmd, "No runnable active file."),
              },
              {
                id: "run-without-debug",
                label: "Run Without Debugging",
                shortcut: "Ctrl+F5",
                disabled: !runCmd,
                onSelect: () => queueCommand(runCmd, "No runnable active file."),
              },
              {
                id: "run-build-task",
                label: "Run Build Task",
                shortcut: "Ctrl+Shift+B",
                disabled: !buildCmd,
                onSelect: () => queueCommand(buildCmd, "No build task for the active file."),
              },
              {
                id: "run-test-task",
                label: "Run Test Task",
                disabled: !testCmd,
                onSelect: () => queueCommand(testCmd, "No test task for the active file."),
              },
              {
                id: "run-open-view",
                label: "Show Run and Debug",
                shortcut: "Ctrl+Shift+D",
                onSelect: () => openView("tasks"),
              },
            ],
          },
          {
            id: "more-terminal",
            label: "Terminal",
            submenu: [
              {
                id: "terminal-new",
                label: "New Terminal",
                shortcut: "Ctrl+Shift+`",
                onSelect: () => {
                  ensureTerminalVisible();
                  requestNewTerminal();
                },
              },
              {
                id: "terminal-split",
                label: "Split Terminal",
                onSelect: () => {
                  ensureTerminalVisible();
                  requestSplitTerminal();
                },
              },
              {
                id: "terminal-toggle",
                label: showTerminal ? "Hide Terminal" : "Show Terminal",
                shortcut: "Ctrl+`",
                onSelect: () => toggleTerminal(),
              },
              {
                id: "terminal-run-active",
                label: "Run Active File",
                disabled: !runCmd,
                onSelect: () => queueCommand(runCmd, "No runnable active file."),
              },
              {
                id: "terminal-focus",
                label: "Focus Terminal",
                onSelect: () => ensureTerminalVisible(),
              },
              {
                id: "terminal-clear",
                label: "Clear Active Terminal",
                onSelect: () => {
                  ensureTerminalVisible();
                  requestClearTerminal();
                },
              },
              {
                id: "terminal-kill-active",
                label: "Kill Active Terminal",
                onSelect: () => requestCloseActiveTerminal(),
              },
              {
                id: "terminal-close-panel",
                label: "Close Terminal Panel",
                disabled: !showTerminal,
                onSelect: () => {
                  if (showTerminal) toggleTerminal();
                },
              },
            ],
          },
          {
            id: "more-help",
            label: "Help",
            submenu: [
              {
                id: "help-commands",
                label: "Show All Commands",
                onSelect: () => openCommandPalette(),
              },
              {
                id: "help-welcome",
                label: "Welcome",
                onSelect: () => {
                  closeAllTabs();
                  addToast("Welcome screen restored.", "info");
                },
              },
              {
                id: "help-keybindings",
                label: "Keyboard Shortcuts",
                onSelect: () => openView("keybindings"),
              },
              {
                id: "help-about",
                label: "About NCode",
                onSelect: () => addToast("NCode workbench menus updated to mirror VS Code sections.", "info"),
              },
            ],
          },
        ],
      },
    ];

  const renderMenuEntries = (
    entries: MenuEntry[],
    level: number,
    ancestorIds: string[]
  ) => (
    <div className={`menu-dropdown level-${level}`}>
      {entries.map((entry) => {
        if (entry.label === "" && entry.disabled) {
          return <div key={entry.id} className="menu-separator" />;
        }

        const submenuOpen =
          !!entry.submenu &&
          openPath.length > level + 1 &&
          ancestorIds.every((id, index) => openPath[index] === id) &&
          openPath[level + 1] === entry.id;

        return (
          <div
            key={entry.id}
            className={`menu-entry-wrap ${submenuOpen ? "submenu-open" : ""}`}
            onMouseEnter={() => {
              if (!openPath.length) return;
              if (entry.submenu) {
                setOpenPath([...ancestorIds, entry.id]);
              } else {
                setOpenPath(ancestorIds);
              }
            }}
          >
            <button
              className={`menu-entry ${entry.disabled ? "disabled" : ""}`}
              disabled={entry.disabled}
              onClick={(event) => {
                event.stopPropagation();
                if (entry.submenu) {
                  setOpenPath([...ancestorIds, entry.id]);
                  return;
                }
                runLeafAction(entry).catch((error) => {
                  console.error("Menu action failed:", error);
                  addToast(String(error), "error");
                });
              }}
            >
              <span className="menu-check">{entry.checked ? "✓" : ""}</span>
              <span className="menu-label">{entry.label}</span>
              {entry.shortcut && <span className="menu-shortcut">{entry.shortcut}</span>}
              {entry.submenu && <span className="menu-submenu-caret">›</span>}
            </button>

            {entry.submenu && submenuOpen && renderMenuEntries(entry.submenu, level + 1, [...ancestorIds, entry.id])}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="menu-bar" ref={containerRef}>
      {rootMenus.map((menu) => {
        const rootOpen = openPath[0] === menu.id;
        return (
          <div
            key={menu.id}
            className={`menu-root-wrap ${rootOpen ? "open" : ""}`}
            onMouseEnter={() => {
              if (openPath.length > 0) setOpenPath([menu.id]);
            }}
          >
            <button
              className={`menu-root-button ${rootOpen ? "open" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                setOpenPath((current) => (current[0] === menu.id ? [] : [menu.id]));
              }}
            >
              {menu.label}
            </button>
            {rootOpen && renderMenuEntries(menu.items, 0, [menu.id])}
          </div>
        );
      })}
    </div>
  );
});
