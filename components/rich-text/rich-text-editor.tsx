"use client";

import { useEffect, useRef, useState } from "react";
import Bold from "@tiptap/extension-bold";
import BulletList from "@tiptap/extension-bullet-list";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import History from "@tiptap/extension-history";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import ListItem from "@tiptap/extension-list-item";
import OrderedList from "@tiptap/extension-ordered-list";
import Paragraph from "@tiptap/extension-paragraph";
import Strike from "@tiptap/extension-strike";
import Text from "@tiptap/extension-text";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Link2,
  List,
  ListOrdered,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import {
  isSafeLinkHref,
  normalizeLinkInput,
  normalizeRichText,
  sanitizeRichText,
} from "@/lib/rich-text/html";
import { cn } from "@/lib/utils";

export const richTextFrameClassName =
  "min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-background dark:bg-accent";

export const richTextToolbarClassName =
  "flex max-w-full gap-0.5 overflow-x-auto overscroll-x-contain border-b border-border p-1";

const editorContentClassName =
  "max-w-full min-h-28 break-words px-3 py-2 text-sm leading-relaxed outline-none [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:underline";

type ToolbarButton = {
  label: string;
  icon: typeof BoldIcon;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export function RichTextToolbar({
  buttons,
  disabled,
}: {
  buttons: ToolbarButton[];
  disabled?: boolean;
}) {
  return (
    <div
      className={richTextToolbarClassName}
      role="toolbar"
      aria-label="Formato"
    >
      {buttons.map((button) => {
        const Icon = button.icon;
        return (
          <button
            key={button.label}
            type="button"
            aria-label={button.label}
            aria-pressed={button.active ? true : false}
            disabled={disabled || button.disabled}
            className={cn(
              "inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2 text-sm",
              button.active ? "bg-muted text-foreground" : "text-muted-foreground",
              "hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            )}
            onMouseDown={(event) => event.preventDefault()}
            onClick={button.onClick}
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function toolbarButtons(editor: Editor, disabled: boolean): ToolbarButton[] {
  const chain = () => editor.chain().focus();
  return [
    {
      label: "Negrita",
      icon: BoldIcon,
      active: editor.isActive("bold"),
      disabled,
      onClick: () => chain().toggleBold().run(),
    },
    {
      label: "Cursiva",
      icon: ItalicIcon,
      active: editor.isActive("italic"),
      disabled,
      onClick: () => chain().toggleItalic().run(),
    },
    {
      label: "Subrayado",
      icon: UnderlineIcon,
      active: editor.isActive("underline"),
      disabled,
      onClick: () => chain().toggleUnderline().run(),
    },
    {
      label: "Tachado",
      icon: Strikethrough,
      active: editor.isActive("strike"),
      disabled,
      onClick: () => chain().toggleStrike().run(),
    },
    {
      label: "Lista con viñetas",
      icon: List,
      active: editor.isActive("bulletList"),
      disabled,
      onClick: () => chain().toggleBulletList().run(),
    },
    {
      label: "Lista numerada",
      icon: ListOrdered,
      active: editor.isActive("orderedList"),
      disabled,
      onClick: () => chain().toggleOrderedList().run(),
    },
    {
      label: "Enlace",
      icon: Link2,
      active: editor.isActive("link"),
      disabled,
      onClick: () => {
        const previous = editor.getAttributes("link").href as string | undefined;
        const entered = window.prompt("Enlace", previous ?? "https://");
        if (entered == null) {
          return;
        }
        const href = normalizeLinkInput(entered);
        if (!href) {
          chain().unsetLink().run();
          return;
        }
        chain().extendMarkRange("link").setLink({ href }).run();
      },
    },
    {
      label: "Deshacer",
      icon: Undo2,
      disabled: disabled || !editor.can().undo(),
      onClick: () => chain().undo().run(),
    },
    {
      label: "Rehacer",
      icon: Redo2,
      disabled: disabled || !editor.can().redo(),
      onClick: () => chain().redo().run(),
    },
    {
      label: "Quitar formato",
      icon: RemoveFormatting,
      disabled,
      onClick: () => chain().unsetAllMarks().clearNodes().run(),
    },
  ];
}

export function RichTextEditor({
  value,
  onChange,
  disabled = false,
  readOnly = false,
  invalid = false,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  ariaLabel: string;
}) {
  const locked = disabled || readOnly;
  const emitted = useRef<string | null>(null);
  const [, setRevision] = useState(0);
  const editor = useEditor({
    immediatelyRender: false,
    editable: !locked,
    extensions: [
      Document,
      Paragraph,
      Text,
      Bold,
      Italic,
      Underline,
      Strike,
      BulletList,
      OrderedList,
      ListItem,
      HardBreak,
      History,
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: { rel: "noopener noreferrer" },
        isAllowedUri: (url) => isSafeLinkHref(url),
      }),
    ],
    content: normalizeRichText(value) || "<p></p>",
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "aria-invalid": invalid ? "true" : "false",
        class: editorContentClassName,
      },
      transformPastedHTML(html) {
        return sanitizeRichText(html);
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = normalizeRichText(current.getHTML());
      emitted.current = next;
      onChange(next);
    },
    onTransaction: () => setRevision((revision) => revision + 1),
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    editor.setEditable(!locked);
  }, [editor, locked]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const canonical = normalizeRichText(value);
    if (emitted.current === value || emitted.current === canonical) {
      return;
    }
    if (normalizeRichText(editor.getHTML()) === canonical) {
      emitted.current = canonical;
      return;
    }
    editor.commands.setContent(canonical || "<p></p>", { emitUpdate: false });
    emitted.current = canonical;
  }, [editor, value]);

  return (
    <div
      className={cn(
        richTextFrameClassName,
        invalid && "border-destructive",
        locked && "opacity-70"
      )}
      data-disabled={locked ? "true" : "false"}
      data-invalid={invalid ? "true" : "false"}
    >
      <RichTextToolbar
        disabled={locked || !editor}
        buttons={editor ? toolbarButtons(editor, locked) : []}
      />
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div className={editorContentClassName} />
      )}
    </div>
  );
}
