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

/**
 * 按代码结构切块：在 def / class / function 边界处切开，并把函数名写进块首。
 * 固定窗口会把函数切两半，模型就无法回答"哪个函数有 bug"这类问题。
 */
const BOUNDARY = /\n(?=(?:def |class |async def |function |public function |private function |protected function |func ))/g;
const SYMBOL = /(?:def|class|function|func)\s+([A-Za-z_][\w]*)/;

export function chunkByStructure(text: string, size = 4000): RawChunk[] {
  const marks: number[] = [0];
  for (const m of text.matchAll(BOUNDARY)) {
    const at = (m.index ?? 0) + 1;
    if (at > 0 && at < text.length) marks.push(at);
  }
  marks.push(text.length);

  const out: RawChunk[] = [];
  const push = (s: number, e: number) => {
    out.push({ id: `c${out.length}`, start: s, end: e, text: text.slice(s, e) });
  };

  let start = marks[0];
  for (let i = 1; i < marks.length; i += 1) {
    const end = marks[i];
    const span = end - start;
    if (span < size) {
      // 还没攒够：如果是最后一段就收尾，否则继续并
      if (i === marks.length - 1) push(start, end);
      continue;
    }
    push(start, end);
    start = end;
  }
  if (start < text.length && (out.length === 0 || out[out.length - 1].end < text.length)) {
    push(start, text.length);
  }

  // 超长段（单块仍 > size*1.5）退回窗口切；同时给每块加"所属函数"抬头
  const fixed: RawChunk[] = [];
  for (const c of out) {
    const body = c.text;
    if (body.length <= size * 1.5) {
      fixed.push({ ...c, id: `c${fixed.length}` });
      continue;
    }
    for (let i = 0; i < body.length; i += size) {
      fixed.push({ id: `c${fixed.length}`, start: c.start + i, end: Math.min(c.end, c.start + i + size), text: body.slice(i, i + size) });
    }
  }

  return fixed.map((c, idx) => {
    const m = SYMBOL.exec(c.text);
    const symbol = m ? m[1] : '';
    return { ...c, id: `c${idx}`, text: symbol ? `# [function: ${symbol}]\n${c.text}` : c.text };
  });
}
