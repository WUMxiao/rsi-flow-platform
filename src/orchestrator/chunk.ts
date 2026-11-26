// 切块：固定窗口 + 少量重叠。
// 3.86M 字符按 4000/块 → 约 966 块；只存位置与文本，不做任何模型调用。
export interface RawChunk {
  id: string;
  start: number;
  end: number;
  text: string;
}

export function chunkText(text: string, size = 4000, overlap = 200): RawChunk[] {
  const out: RawChunk[] = [];
  if (!text) return out;
  const step = Math.max(1, size - overlap);
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + size);
    out.push({ id: `c${out.length}`, start: i, end, text: text.slice(i, end) });
    if (end >= text.length) break;
    i += step;
  }
  return out;
}

/** 预览用：压掉换行与连续空白，截断到 n 字符 */
export function preview(s: string, n = 160): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, n);
}
