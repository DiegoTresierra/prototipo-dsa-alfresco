export function formatDocumentDate(value) {
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
