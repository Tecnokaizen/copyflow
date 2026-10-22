import { Extension, Mark } from "@tiptap/react";
import {
  TEXT_ALIGN_ATTRIBUTE,
  TEXT_COLOR_ATTRIBUTE,
  TEXT_SIZE_ATTRIBUTE,
  textAlignOf,
  textColorOf,
  textSizeOf,
} from "@/lib/rich-text/text-styles";

/**
 * One mark per style so size and color change independently. Each renders a
 * `<span>` with a single token attribute, which is exactly what the sanitizer
 * keeps; any other value does not parse as the mark.
 */
function tokenMark(name: string, attribute: string, read: (value: unknown) => string | null) {
  return Mark.create({
    name,
    addAttributes() {
      return {
        value: {
          default: null,
          parseHTML: (element) => read(element.getAttribute(attribute)),
          renderHTML: (attributes) =>
            attributes.value ? { [attribute]: attributes.value } : {},
        },
      };
    },
    parseHTML() {
      return [
        {
          tag: `span[${attribute}]`,
          // A span may carry both tokens: let the other mark read it too.
          consuming: false,
          getAttrs: (element) => (read(element.getAttribute(attribute)) ? null : false),
        },
      ];
    },
    renderHTML({ HTMLAttributes }) {
      return ["span", HTMLAttributes, 0];
    },
  });
}

export const TextSizeMark = tokenMark("textSize", TEXT_SIZE_ATTRIBUTE, textSizeOf);
export const TextColorMark = tokenMark("textColor", TEXT_COLOR_ATTRIBUTE, textColorOf);

/**
 * Alignment belongs to the paragraph (list items hold paragraphs too), never
 * to a span. Left is `null` and renders no attribute; Enter keeps the
 * alignment of the paragraph being split.
 */
export const ParagraphAlign = Extension.create({
  name: "paragraphAlign",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => textAlignOf(element.getAttribute(TEXT_ALIGN_ATTRIBUTE)),
            renderHTML: (attributes) =>
              attributes.textAlign ? { [TEXT_ALIGN_ATTRIBUTE]: attributes.textAlign } : {},
          },
        },
      },
    ];
  },
});
