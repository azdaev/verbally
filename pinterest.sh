#!/bin/sh
# pinterest.sh "moody foggy mountains" [count]: prints addresses of full-size Pinterest images, one per line.
# The design engine calls it, so a "photo from Pinterest" costs one tool call, not a browser session that it has to figure out.
# It uses playwriter: a tab in the user's Chrome, closed at the end.
q=$(printf %s "$1" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read()))')
s=$(playwriter session new 2>&1 | grep -oE 'Session [0-9]+' | grep -oE '[0-9]+')
[ -n "$s" ] || { echo "playwriter: no session" >&2; exit 1; }
playwriter -s "$s" -e "
const p = await context.newPage()
try {
  await p.goto('https://www.pinterest.com/search/pins/?q=$q')
  await p.waitForSelector('img[src*=pinimg]', { timeout: 10000 })
  await p.waitForTimeout(1500)
  const s = await p.\$\$eval('img[src*=pinimg]', a => a.filter(i => i.naturalWidth >= 200).map(i => i.src.replace(/\/\d+x(\/|_RS\/)/, '/originals/')))
  console.log([...new Set(s)].slice(0, ${2:-8}).join('\n'))
} finally { await p.close() }" 2>&1 | grep -E '^https://i\.pinimg\.com/'
playwriter session delete "$s" >/dev/null 2>&1
