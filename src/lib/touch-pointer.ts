/**
 * 触屏指针判定。
 *
 * 用途：播放器控制栏交互分流（issue LibreSpark/LibreTV#937）——
 * 触屏设备没有 hover，控制栏只能靠「点按视频 toggle」显示/收起，
 * 任何自动隐藏（ArtPlayer 按 CONTROL_HIDE_TIME 计时收起）都会让按钮点不到；
 * 桌面鼠标维持「mousemove 显示 + 失去悬停收起」。
 *
 * 用媒体查询而非 UA 嗅探：`(any-pointer: coarse)` 检测是否存在手指触控输入，
 * 不依赖主指针类型；因此连接鼠标/触控板的触屏笔记本、平板仍保留可点按控制栏。
 */
export function prefersTouchPointer(
  match?: (query: string) => { matches: boolean }
): boolean {
  try {
    if (match) return match('(any-pointer: coarse)').matches;
    // SSR / 老浏览器没有 matchMedia：按桌面（非触屏）处理，行为与现状一致
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(any-pointer: coarse)').matches;
  } catch {
    return false;
  }
}
