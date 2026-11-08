// #kurallar kanalındaki metin düzeni: "# başlık", "### emoji bölüm", "> gövde", sonda "> emoji *not*"
import { e } from './emojis.js';

export const quote = (text) => text.split('\n').map((line) => `> ${line}`).join('\n');

export const sectionsText = (sections) =>
  sections.map((s) => `### ${s.icon}   ${s.title}\n${quote(s.body)}`).join('\n\n\n');

export function ruleText({ icon, title, intro, sections = [], note }) {
  let out = `# ${icon}  Karia — ${title}`;
  if (intro) out += `\n\n${intro}`;
  if (sections.length) out += `\n\n\n${sectionsText(sections)}`;
  if (note) out += `\n\n\n> ${e('ampul', '💡')}  *${note}*`;
  return out;
}

/** Metni satır sınırlarından keserek Discord'un mesaj sınırına böler. */
export function splitText(text, max = 2000) {
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    const piece = line.slice(0, max);
    if (current && current.length + piece.length + 1 > max) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export const fit = (text, max = 2000) => splitText(text, max)[0] ?? '';
