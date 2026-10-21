"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
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
  ALargeSmall,
  Baseline,
  Bold as BoldIcon,
  ChevronDown,
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
  TextColorMark,
  TextSizeMark,
} from "@/components/rich-text/text-style-marks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isSafeLinkHref,
  normalizeLinkInput,
  normalizeRichText,
  sanitizeRichText,
} from "@/lib/rich-text/html";
import {
  TEXT_COLOR_ATTRIBUTE,
  TEXT_COLORS,
  TEXT_SIZE_ATTRIBUTE,
  TEXT_SIZES,
  textColorOf,
  textSizeOf,
} from "@/lib/rich-text/text-styles";
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

/** A control that renders itself (e.g. a menu) in the toolbar row. */
type ToolbarControl = { label: string; control: ReactNode };

function toolbarButtonClassName(active: boolean | undefined) {
  return cn(
    "inline-flex h-8 shrink-0 items-center justify-center gap-0.5 rounded-md px-2 text-sm",
    active ? "bg-muted text-foreground" : "text-muted-foreground",
    "hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
  );
}

export function RichTextToolbar({
  buttons,
  disabled,
}: {
  buttons: Array<ToolbarButton | ToolbarControl>;
  disabled?: boolean;
}) {
  return (
    <div
      className={richTextToolbarClassName}
      role="toolbar"
      aria-label="Formato"
    >
      {buttons.map((button) => {
        if ("control" in button) {
          return <Fragment key={button.label}>{button.control}</Fragment>;
        }
        const Icon = button.icon;
        return (
          <button
            key={button.label}
            type="button"
            aria-label={button.label}
            aria-pressed={button.active ? true : false}
            disabled={disabled || button.disabled}
            className={toolbarButtonClassName(button.active)}
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

const NORMAL = "normal";

/**
 * Size or color menu. The editor keeps its selection while the menu is open;
 * choosing an option applies it there and returns focus to the text.
 */
function TextStyleMenu({
  editor,
  disabled,
  mark,
  label,
  icon,
  normalLabel,
  options,
  attribute,
  read,
}: {
  editor: Editor;
  disabled: boolean;
  mark: "textSize" | "textColor";
  label: string;
  icon: ReactNode;
  normalLabel: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  attribute: string;
  read: (value: unknown) => string | null;
}) {
  const chosen = useRef(false);
  const current = read(editor.getAttributes(mark).value) ?? NORMAL;
  const currentLabel =
    options.find((option) => option.value === current)?.label ?? normalLabel;
  const items = [
    ...(mark === "textSize" ? [options[0]] : []),
    { value: NORMAL, label: normalLabel },
    ...(mark === "textSize" ? options.slice(1) : options),
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`${label}: ${currentLabel}`}
          title={label}
          className={toolbarButtonClassName(current !== NORMAL)}
        >
          {icon}
          <ChevronDown className="size-3" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-44"
        onCloseAutoFocus={(event) => {
          // After a choice, keep writing where the text was; after Escape,
          // focus returns to the button (menu button pattern). Never take
          // focus from another menu opened meanwhile.
          if (!chosen.current) return;
          chosen.current = false;
          event.preventDefault();
          if (document.activeElement?.closest('[role="menu"]')) return;
          editor.commands.focus();
        }}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {label}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => {
            chosen.current = true;
            // Focus now (not when the menu finishes closing) so typing goes on.
            const chain = editor.chain().focus();
            if (value === NORMAL) {
              chain.unsetMark(mark).run();
            } else {
              chain.setMark(mark, { value }).run();
            }
          }}
        >
          {items.map((item) => (
            <DropdownMenuRadioItem
              key={item.value}
              value={item.value}
              className="min-h-10 gap-2"
            >
              {mark === "textColor" ? (
                <span
                  aria-hidden="true"
                  className="gc-text-swatch size-3.5 shrink-0 rounded-full border border-border"
                  {...(item.value === NORMAL ? {} : { [attribute]: item.value })}
                />
              ) : null}
              <span {...(item.value === NORMAL ? {} : { [attribute]: item.value })}>
                {item.label}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function textStyleControls(editor: Editor, disabled: boolean): ToolbarControl[] {
  const color = textColorOf(editor.getAttributes("textColor").value);
  return [
    {
      label: "Tamaño del texto",
      control: (
        <TextStyleMenu
          editor={editor}
          disabled={disabled}
          mark="textSize"
          label="Tamaño del texto"
          icon={<ALargeSmall className="size-4" aria-hidden="true" />}
          normalLabel="Normal"
          options={TEXT_SIZES}
          attribute={TEXT_SIZE_ATTRIBUTE}
          read={textSizeOf}
        />
      ),
    },
    {
      label: "Color del texto",
      control: (
        <TextStyleMenu
          editor={editor}
          disabled={disabled}
          mark="textColor"
          label="Color del texto"
          icon={
            <span className="relative inline-flex">
              <Baseline className="size-4" aria-hidden="true" />
              <span
                aria-hidden="true"
                className="gc-text-swatch absolute inset-x-0.5 -bottom-0.5 h-1 rounded-full"
                {...(color ? { [TEXT_COLOR_ATTRIBUTE]: color } : {})}
              />
            </span>
          }
          normalLabel="Predeterminado"
          options={TEXT_COLORS}
          attribute={TEXT_COLOR_ATTRIBUTE}
          read={textColorOf}
        />
      ),
    },
  ];
}

function toolbarButtons(
  editor: Editor,
  disabled: boolean,
  textStyles: boolean
): Array<ToolbarButton | ToolbarControl> {
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
    ...(textStyles ? textStyleControls(editor, disabled) : []),
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
      // Also resets size and color to the defaults (they are marks too).
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
  textStyles = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  ariaLabel: string;
  /** Offer the text size and color menus (fixed when the editor mounts). */
  textStyles?: boolean;
}) {
  const locked = disabled || readOnly;
  const options = { textStyles };
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
      ...(textStyles ? [TextSizeMark, TextColorMark] : []),
    ],
    content: normalizeRichText(value, options) || "<p></p>",
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "aria-invalid": invalid ? "true" : "false",
        class: editorContentClassName,
      },
      transformPastedHTML(html) {
        return sanitizeRichText(html, options);
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = normalizeRichText(current.getHTML(), options);
      emitted.current = next;
      onChange(next);
    },
    onTransaction: () => setRevision((revision) => revision + 1),
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    // Changing availability is not a document edit (Tiptap emits update by default).
    editor.setEditable(!locked, false);
  }, [editor, locked]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const canonical = normalizeRichText(value, { textStyles });
    if (emitted.current === value || emitted.current === canonical) {
      return;
    }
    if (normalizeRichText(editor.getHTML(), { textStyles }) === canonical) {
      emitted.current = canonical;
      return;
    }
    editor.commands.setContent(canonical || "<p></p>", { emitUpdate: false });
    emitted.current = canonical;
  }, [editor, value, textStyles]);

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
        buttons={editor ? toolbarButtons(editor, locked, textStyles) : []}
      />
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div className={editorContentClassName} />
      )}
    </div>
  );
}
