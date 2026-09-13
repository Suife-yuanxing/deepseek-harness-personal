/** `secscan` namespace dictionaries (the settings rows' and strip's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'secscan.mode.title': '出口安全扫描',
  'secscan.mode.off': '关闭',
  'secscan.mode.monitor': '观察',
  'secscan.mode.redact': '抹除',
  'secscan.mode.block': '拦截',
  'secscan.desc.off': '不扫描出站消息。',
  'secscan.desc.monitor': '记录疑似敏感内容到本地审计，不改动发送内容。',
  'secscan.desc.redact': '发送前把疑似密钥替换为占位符（保留尾 4 位）。',
  'secscan.desc.block': '发现疑似敏感内容时先询问：放行原样发送，或拒绝并中止本轮。',
  'secscan.ignore.title': '忽略规则',
  'secscan.ignore.hint': '逗号分隔的规则 ID，例如 generic-sk-token, high-entropy',
  'secscan.strip.body': 'SecScan（{mode}）：发现 {count} 处疑似敏感内容',
  'secscan.strip.dismiss': '知道了',
} satisfies Record<string, string>

/** The secscan namespace key union. */
export type SecscanKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'secscan.mode.title': 'Egress secret scan',
  'secscan.mode.off': 'Off',
  'secscan.mode.monitor': 'Monitor',
  'secscan.mode.redact': 'Redact',
  'secscan.mode.block': 'Block',
  'secscan.desc.off': 'Do not scan outbound messages.',
  'secscan.desc.monitor': 'Record suspected secrets to the local audit; send unchanged.',
  'secscan.desc.redact': 'Replace suspected secrets with placeholders before sending (tail 4 kept).',
  'secscan.desc.block': 'Ask before sending suspected secrets: allow once, or reject and stop the turn.',
  'secscan.ignore.title': 'Ignored rules',
  'secscan.ignore.hint': 'Comma-separated rule IDs, e.g. generic-sk-token, high-entropy',
  'secscan.strip.body': 'SecScan ({mode}): {count} suspected secret(s) in this message',
  'secscan.strip.dismiss': 'Dismiss',
} satisfies Record<SecscanKey, string>
