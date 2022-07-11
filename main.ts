import { EditorExtensions } from "editor-enhancements";
import { Plugin, MarkdownView, Editor } from "obsidian";
import {
  AutoLinkTitleSettings,
  AutoLinkTitleSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";
import { CheckIf } from "checkif";
import getPageTitle from "scraper";

interface PasteFunction {
  (this: HTMLElement, ev: ClipboardEvent): void;
}

export default class AutoLinkTitle extends Plugin {
  settings: AutoLinkTitleSettings;
  pasteFunction: PasteFunction;

  async onload() {
    console.log("loading obsidian-auto-link-title");
    await this.loadSettings();

    // Listen to paste event
    this.pasteFunction = this.pasteUrlWithTitle.bind(this);

    this.addCommand({
      id: "auto-link-title-paste",
      name: "Paste URL and auto fetch title",
      callback: () => {
        this.manualPasteUrlWithTitle();
      },
      hotkeys: [],
    });

    this.registerEvent(
      this.app.workspace.on("editor-paste", this.pasteFunction)
    );

    this.addCommand({
      id: "enhance-url-with-title",
      name: "Enhance existing URL with link and title",
      callback: () => this.addTitleToLink(),
      hotkeys: [
        {
          modifiers: ["Mod", "Shift"],
          key: "e",
        },
      ],
    });

    this.addSettingTab(new AutoLinkTitleSettingTab(this.app, this));
  }

  addTitleToLink(): void {
    // Only attempt fetch if online
    if (!navigator.onLine) return;

    let editor = this.getEditor();
    if (editor == null) return;

    let selectedText = (EditorExtensions.getSelectedText(editor) || "").trim();

    // If the cursor is on a raw html link, convert to a markdown link and fetch title
    if (CheckIf.isUrl(selectedText)) {
      this.convertUrlToTitledLink(editor, selectedText);
    }
    // If the cursor is on the URL part of a markdown link, fetch title and replace existing link title
    else if (CheckIf.isLinkedUrl(selectedText)) {
      var link = this.getUrlFromLink(selectedText);
      this.convertUrlToTitledLink(editor, link);
    }
  }

  // Simulate standard paste but using editor.replaceSelection with clipboard text since we can't seem to dispatch a paste event.
  async manualPasteUrlWithTitle(): Promise<void> {
    let editor = this.getEditor();
    if (!editor) return;

    // Only attempt fetch if online
    if (!navigator.onLine) {
      editor.replaceSelection(clipboardText);
      return;
    }

    var clipboardText = await navigator.clipboard.readText();
    if (clipboardText == null || clipboardText == "") return;

    // If its not a URL, we return false to allow the default paste handler to take care of it.
    // Similarly, image urls don't have a meaningful <title> attribute so downloading it
    // to fetch the title is a waste of bandwidth.
    var isEagleLink=CheckIf.isEaglelink(clipboardText);
    console.log(isEagleLink);
    if ((!CheckIf.isUrl(clipboardText)&&isEagleLink) || CheckIf.isImage(clipboardText)) {
      editor.replaceSelection(clipboardText);
      return;
    }

    let selectedText = (EditorExtensions.getSelectedText(editor) || "").trim();
    if (selectedText && !this.settings.shouldReplaceSelection) {
      // If there is selected text and shouldReplaceSelection is false, do not fetch title
      editor.replaceSelection(clipboardText);
      return;
    }

    // If it looks like we're pasting the url into a markdown link already, don't fetch title
    // as the user has already probably put a meaningful title, also it would lead to the title
    // being inside the link.
    if (CheckIf.isMarkdownLinkAlready(editor) || CheckIf.isAfterQuote(editor)) {
      editor.replaceSelection(clipboardText);
      return;
    }

    // At this point we're just pasting a link in a normal fashion, fetch its title.
    this.convertUrlToTitledLink(editor, clipboardText);
    return;
  }

  async pasteUrlWithTitle(clipboard: ClipboardEvent): Promise<void> {
    if (!this.settings.enhanceDefaultPaste) {
      return;
    }

    // Only attempt fetch if online
    if (!navigator.onLine) return;

    let editor = this.getEditor();
    if (!editor) return;

    let clipboardText = clipboard.clipboardData.getData("text/plain");
    if (clipboardText == null || clipboardText == "") return;

    // If its not a URL, we return false to allow the default paste handler to take care of it.
    // Similarly, image urls don't have a meaningful <title> attribute so downloading it
    // to fetch the title is a waste of bandwidth.
    var isEagleLink=CheckIf.isEaglelink(clipboardText);

    if ((!CheckIf.isUrl(clipboardText)&&!isEagleLink) || CheckIf.isImage(clipboardText)) {
      return;
    }

    let selectedText = (EditorExtensions.getSelectedText(editor) || "").trim();
    if (selectedText && !this.settings.shouldReplaceSelection) {
      // If there is selected text and shouldReplaceSelection is false, do not fetch title
      return;
    }

    // We've decided to handle the paste, stop propagation to the default handler.
    clipboard.stopPropagation();
    clipboard.preventDefault();

    // If it looks like we're pasting the url into a markdown link already, don't fetch title
    // as the user has already probably put a meaningful title, also it would lead to the title
    // being inside the link.
    if (CheckIf.isMarkdownLinkAlready(editor) || CheckIf.isAfterQuote(editor)) {
      editor.replaceSelection(clipboardText);
      return;
    }

    if(isEagleLink){
        // At this point we're just pasting a link in a normal fashion, fetch its title.
        this.convertEagleLinkToTitledLink(editor, clipboardText);

    }else{
      // At this point we're just pasting a link in a normal fashion, fetch its title.
        this.convertUrlToTitledLink(editor, clipboardText);

    }


 
    return;
  }

  async convertEagleLinkToTitledLink(editor: Editor, url: string): Promise<void> {
    // Generate a unique id for find/replace operations for the title.
    const pasteId = `Fetching EagleLink Title#${this.createBlockHash()}`;

    // Instantly paste so you don't wonder if paste is broken
    editor.replaceSelection(`[${pasteId}](${url})`);

    // Fetch title from site, replace Fetching Title with actual title
    const title = await this.fetchEagleLinkTitle(url);

    // console.log("获取到的 标题:+"+title)
    const text = editor.getValue();

    const start = text.indexOf(pasteId);
    if (start < 0) {
      console.log(
        `Unable to find text "${pasteId}" in current editor, bailing out; link ${url}`
      );
      // const end = start + pasteId.length;
      // const startPos = EditorExtensions.getEditorPositionFromIndex(text, start);
      // const endPos = EditorExtensions.getEditorPositionFromIndex(text, end);
      // editor.replaceRange("无法连接Eagle服务器", startPos, endPos);
    } else {
      const end = start + pasteId.length;
      const startPos = EditorExtensions.getEditorPositionFromIndex(text, start);
      const endPos = EditorExtensions.getEditorPositionFromIndex(text, end);
      editor.replaceRange(title, startPos, endPos);
    }
  }


  async convertUrlToTitledLink(editor: Editor, url: string): Promise<void> {
    // Generate a unique id for find/replace operations for the title.
    const pasteId = `Fetching Title#${this.createBlockHash()}`;

    // Instantly paste so you don't wonder if paste is broken
    editor.replaceSelection(`[${pasteId}](${url})`);

    // Fetch title from site, replace Fetching Title with actual title
    const title = await this.fetchUrlTitle(url);

    const text = editor.getValue();

    const start = text.indexOf(pasteId);
    if (start < 0) {
      console.log(
        `Unable to find text "${pasteId}" in current editor, bailing out; link ${url}`
      );
    } else {
      const end = start + pasteId.length;
      const startPos = EditorExtensions.getEditorPositionFromIndex(text, start);
      const endPos = EditorExtensions.getEditorPositionFromIndex(text, end);

      editor.replaceRange(title, startPos, endPos);
    }
  }

  async fetchUrlTitle(url: string): Promise<string> {
    try {
      const title = await getPageTitle(url);
      return title.replace(/(\r\n|\n|\r)/gm, "").trim();
    } catch (error) {
      // console.error(error)
      return "Site Unreachable";
    }
  }

 
  


  async fetchEagleLinkTitle(url: string): Promise<string> {
      var  title = "ealge 默认标题 ";
      const matches = url.match(DEFAULT_SETTINGS.eagleRegex);
      const id = matches.groups.id;
      const linkType = matches.groups.type;
      var urlItem="http://localhost:41595/api/item/info?id="+id;
      //var urlLib="http://localhost:41595/api/folder/list";

      if(linkType=="item"){
        await fetch(urlItem, {  method: 'GET', redirect: 'follow'}).then((response) => {
          if (response.ok) {
            return response.json();
          }
        }).then((responseJson) => {
          // console.log(responseJson);
          title=responseJson.data.name+"."+responseJson.data.ext+"|Tag:"+responseJson.data.tags;
          // console.log("data: "+title);
        })
        .catch((error) => {
          console.log(error);
          title= "Eagle 查找失败!";
        });

      }else{
        await fetch(urlItem, {  method: 'GET', redirect: 'follow'}).then((response) => {
          if (response.ok) {
            return response.json();
          }
        }).then((responseJson) => {
          // console.log(responseJson);
          title=responseJson.data.name;
          // console.log("data: "+title);
        })
        .catch((error) => {
          console.log(error);
          title= "Eagle 查找失败!";
        });

      }
      // console.log("return:"+title);
      return title;
  }



  private getEditor(): Editor {
    let activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeLeaf == null) return;
    return activeLeaf.editor;
  }

  public getUrlFromLink(link: string): string {
    let urlRegex = new RegExp(DEFAULT_SETTINGS.linkRegex);
    return urlRegex.exec(link)[2];
  }

  // Custom hashid by @shabegom
  private createBlockHash(): string {
    let result = "";
    var characters = "abcdefghijklmnopqrstuvwxyz0123456789";
    var charactersLength = characters.length;
    for (var i = 0; i < 4; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  onunload() {
    console.log("unloading obsidian-auto-link-title");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
