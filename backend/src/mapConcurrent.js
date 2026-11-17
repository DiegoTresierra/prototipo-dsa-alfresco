export async function mapConcurrent(values, limit, operation) {
  const results = new Array(values.length)
  let next = 0
  let failed = false
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (!failed && next < values.length) {
      const index = next++
      try { results[index] = await operation(values[index], index) } catch (error) { failed = true; throw error }
    }
  }))
  return results
}
