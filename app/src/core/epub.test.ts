import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseEpub } from './epub';

const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

async function sampleEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`,
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="bookid">urn:uuid:test</dc:identifier>
        <dc:title>窗下</dc:title>
        <dc:creator>原创样本</dc:creator>
        <dc:language>zh-Hans</dc:language>
        <meta name="cover" content="cover-img"/>
      </metadata>
      <manifest>
        <item id="cover-img" href="cover.png" media-type="image/png" properties="cover-image"/>
        <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="css" href="style.css" media-type="text/css"/>
      </manifest>
      <spine>
        <itemref idref="c1"/>
        <itemref idref="c2"/>
      </spine>
    </package>`,
  );
  zip.file('OEBPS/style.css', 'p { line-height: 1.8; }');
  zip.file(
    'OEBPS/c1.xhtml',
    `<?xml version="1.0"?>
    <html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="style.css"/></head>
    <body><h1>雨</h1><p>书架上还有一本没读完的书。</p><img src="cover.png" alt=""/></body></html>`,
  );
  zip.file(
    'OEBPS/c2.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><h1>灯</h1><p>灯还亮着。</p></body></html>`,
  );
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
    <nav epub:type="toc"><ol>
      <li><a href="c1.xhtml">雨</a></li>
      <li><a href="c2.xhtml">灯</a></li>
    </ol></nav></body></html>`,
  );
  zip.file('OEBPS/cover.png', PNG);
  return zip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' });
}

describe('parseEpub', () => {
  it('reads opf metadata, spine order, nav, and the cover', async () => {
    const book = await parseEpub(await sampleEpub());
    expect(book.title).toBe('窗下');
    expect(book.author).toBe('原创样本');
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['雨', '灯']);
    expect(book.chapters[0].html).toContain('书架上还有一本没读完的书');
    expect(book.chapters[0].html).toContain('data:image/png;base64,');
    expect(book.chapters[0].styles).toContain('line-height');
    expect(book.toc.map((item) => item.chapterIndex)).toEqual([0, 1]);
    expect(book.coverBytes?.length).toBeGreaterThan(10);
    expect(book.coverMime).toContain('png');
  });
});
