/** Bonjour identity for `_bookshelf._tcp`. The instance name stays ASCII; the display name is only a TXT field. */

export function bonjourInstanceName(displayName: string): string {
  const source = displayName.trim() || '书房';
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(16).padStart(8, '0').slice(0, 4);
  return `BookShelf-${suffix}`;
}

/** TXT advertised on the LAN. The pairing PIN is intentionally absent. */
export function bonjourTxt(displayName: string): Record<string, string> {
  const name = (displayName.trim() || '书房').slice(0, 60);
  return {
    version: '1',
    path: '/v1/books',
    name,
    pinRequired: '1',
  };
}

export function transferDetail(input: {
  bonjour: boolean;
  access: 'granted' | 'denied' | 'unknown';
  ip: string | null;
  wifi: boolean;
  vpn: boolean;
}): string {
  const manual = '搜到 0 台时，把这一页的 IP、端口和 4 位配对码填进 BookPush。配对码不会通过 Bonjour 广播。';
  if (!input.ip || input.ip === '0.0.0.0') {
    return `端口已打开，但没有读到可用地址。请连上 Wi-Fi 后点「重新监听」。${manual}`;
  }
  if (input.ip.startsWith('169.254.')) {
    return `这个地址是本地链路地址，电脑连不上。请重连家里的 Wi-Fi 并关掉 VPN，再点「重新监听」。${manual}`;
  }
  if (input.access === 'denied') {
    return `系统拒绝了本地网络，Windows 会一直搜到 0 台。打开「设置 → 隐私与安全性 → 本地网络」，打开 BookShelf，再点「重新监听」。${manual}`;
  }
  if (input.vpn) {
    return `检测到 VPN。请关掉 VPN，并和电脑使用同一个 Wi-Fi，不要用访客网络。${manual}`;
  }
  if (!input.wifi) {
    return `当前不像 Wi-Fi。请和 Windows 连同一个家里的网络，不要只用蜂窝数据。${manual}`;
  }
  if (input.bonjour) {
    const permission =
      input.access === 'unknown'
        ? '若没弹出权限，到「设置 → 隐私与安全性 → 本地网络」确认 BookShelf 已打开。'
        : '';
    return `已广播 _bookshelf._tcp。BookPush 可以搜索。${permission}${manual}`;
  }
  return `收书端口已打开，但没有广播成功。请允许本地网络（设置 → 隐私与安全性 → 本地网络 → BookShelf），或直接手工填写。${manual}`;
}
