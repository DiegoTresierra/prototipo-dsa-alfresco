export async function collectInboxPages(loadPage, allPages = false) {
  const entries = []
  let more
  do {
    const payload = await loadPage(entries.length)
    const list = payload?.list
    if (!Array.isArray(list?.entries) || list.entries.some((record) => !record?.entry) ||
        (allPages && typeof list.pagination?.hasMoreItems !== 'boolean')) throw new Error('ALFRESCO_INVALID_LIST_RESPONSE')
    entries.push(...list.entries)
    more = allPages && list.pagination.hasMoreItems
    if ((!list.entries.length && more) || entries.length > 10_000) throw new Error('ALFRESCO_INVALID_LIST_RESPONSE')
  } while (more)
  return entries
}
