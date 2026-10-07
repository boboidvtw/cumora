import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { useLocaleStore } from '../src/lib/i18n.ts'
import { ViewBoundary } from '../src/mobile/ViewBoundary.tsx'

// The mobile tab's crash panel used to print the English `name` prop
// ("Chats遇到了一點問題") — the name is for the console, the panel needs the
// translated tab label.
test('crash panel names the tab in the app language', () => {
  const before = useLocaleStore.getState().locale
  try {
    useLocaleStore.setState({ locale: 'zh-TW' })
    const boundary = new ViewBoundary({ name: 'Chats', labelKey: 'nav.chats', children: null })
    boundary.state = { error: new Error('boom') }
    const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
    assert.match(html, /訊息 遇到了一點問題/)
    assert.doesNotMatch(html, /Chats/)
  } finally {
    useLocaleStore.setState({ locale: before })
  }
})
