import windowEpub from '../../assets/samples/window.epub';
import verticalEpub from '../../assets/samples/vertical-traditional.epub';
import notesPdf from '../../assets/samples/notes.pdf';
import azw3 from '../../assets/samples/window-free.azw3';

export const bundledSamples: { moduleId: number; name: string; label: string }[] = [
  { moduleId: windowEpub, name: 'window.epub', label: '窗下 · EPUB' },
  { moduleId: verticalEpub, name: 'vertical-traditional.epub', label: '竖排样本 · EPUB' },
  { moduleId: notesPdf, name: '纸边笔记.pdf', label: '纸边笔记 · PDF' },
  { moduleId: azw3, name: 'window-free.azw3', label: '无 DRM · AZW3' },
];
