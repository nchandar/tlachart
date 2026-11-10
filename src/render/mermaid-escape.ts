// Makes any label safe to put in Mermaid text by writing risky characters as #code; entities.

const BLANK = /\p{White_Space}/u;
const SAFE = /^[\p{L}\p{N} !'()+,\-./=?[\]"_|@{}:\\^%<>]$/u;
// Text Mermaid reads as syntax: '::', '\n', '%%', '<tag', and underscores at word edges.
const HAZARD =
	/:(?=:|$|\S*#)|\\(?=n)|%(?=%)|<(?=[\p{L}/!?])|_(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_/giu;
const DIRECTION = /(direction)\s+(?=LR|RL|TB|BT)/gi;
const DOUBLE_BRACKET = /\[(?=\[)/g;
const C4 = /C4(?=Container|Component|Dynamic|Deployment)/g;
const UNDRAWN = /[\0\x80-\x9f]/;
// Sequences Mermaid swaps in itself before parsing; a label holding one would be corrupted, so a
// pair is split by encoding its first character.
const REWRITTEN = ["ﬂ°", "¶ß"];
const MARKER = /(?<=marker-end=)"/g;
const firstOf = new Map<number, number>();
for (const pair of REWRITTEN) {
	const [first, second] = [...pair].map((c) => c.codePointAt(0) ?? 0);
	firstOf.set(second, first);
}
// How each character is treated: kept, turned into a space, dropped, or written as a #code; entity.
// JOINS flags a character that could join a rewritten pair.
const KEPT = 0;
const BLANKED = 1;
const DROPPED = 2;
const CODED = 3;
const JOINS = 4;
const kindOf = (n: number) => {
	const c = String.fromCodePoint(n);
	const kind =
		c === " "
			? KEPT
			: BLANK.test(c)
				? BLANKED
				: UNDRAWN.test(c)
					? DROPPED
					: SAFE.test(c)
						? KEPT
						: CODED;
	return firstOf.has(n) ? kind | JOINS : kind;
};
const ASCII = Uint8Array.from({ length: 128 }, (_, n) => kindOf(n));
const wide = new Map<number, number>();
const kindAt = (n: number) => {
	if (n < 128) return ASCII[n];
	let kind = wide.get(n);
	if (kind === undefined) wide.set(n, (kind = kindOf(n)));
	return kind;
};
const encode = (s: string, ref: (n: number) => string) => {
	let out = "";
	let run = 0;
	let last = -1;
	for (let i = 0; i < s.length;) {
		let n = s.charCodeAt(i);
		let width = 1;
		if (n >= 0xd800 && n <= 0xdfff) {
			const low = s.charCodeAt(i + 1);
			if (n <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {
				n = 0x10000 + ((n - 0xd800) << 10) + (low - 0xdc00);
				width = 2;
			} else n = 0xfffd;
		}
		let kind = kindAt(n);
		if (kind === DROPPED) {
			out += s.slice(run, i);
			run = i + width;
		} else {
			const joined = kind >= JOINS && firstOf.get(n) === last;
			kind &= ~JOINS;
			if (joined || kind !== KEPT) {
				out += s.slice(run, i);
				if (joined) out += ref(0x2060);
				if (kind === KEPT) run = i;
				else {
					out += kind === BLANKED ? " " : ref(n);
					run = i + width;
				}
			}
			last = n;
		}
		i += width;
	}
	return out + s.slice(run);
};
/**
 * Writes risky characters as entities, so text cannot end Mermaid's syntax or be mangled by it.
 * `ref` renders one code point as that entity.
 */
export const encodeText = (s: string, ref: (n: number) => string) =>
	encode(s, ref)
		.replace(MARKER, `${ref(0x2060)}"`)
		.replace(HAZARD, (c) => ref(c.charCodeAt(0)));
/** Encodes the text, then defuses the words Mermaid reads as directives: direction, [[ and C4. */
export const escapeLabel = (s: string, quoted = false) => {
	const plain = encodeText(s, (n) => `#${n};`);
	const out = quoted ? plain.replaceAll('"', "#34;") : plain;
	if (!out.trim()) return "#32;";
	const turned = out.replace(DIRECTION, "$1#32;");
	const opened = turned.includes("[[") ? turned.replace(DOUBLE_BRACKET, "#91;") : turned;
	return opened.includes("C4") ? opened.replace(C4, "C#52;") : opened;
};
