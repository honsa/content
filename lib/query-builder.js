const pick = (obj, keys = []) => {
  return Object.keys(obj)
    .filter(key => keys.includes(key))
    .reduce((newObj, key) => Object.assign(newObj, { [key]: obj[key] }), {})
}

const omit = (obj, keys = []) => {
  return Object.keys(obj)
    .filter(key => !keys.includes(key))
    .reduce((newObj, key) => Object.assign(newObj, { [key]: obj[key] }), {})
}

class QueryBuilder {
  constructor ({ query, path, init, postprocess = [] }, options) {
    this.query = query
    this.path = path
    this.init = init
    this.postprocess = postprocess
    this.options = options || {}
    this.keys = null

    // Remove text field from response
    this.postprocess.unshift(data => data.map(item => omit(item, ['text'])))
  }

  /**
   * Select a subset of fields
   * @param {Array} keys - Array of fields to be picked.
   * @returns {QueryBuilder} Returns current instance to be chained
   */
  only (keys) {
    // Assign keys to this.keys to be processed in fetch
    this.keys = Array.isArray(keys) ? keys : [keys]
    // Return current instance
    return this
  }

  /**
   * Sort results
   * @param {string} field - Field key to sort on.
   * @param {string} direction - Direction of sort (asc / desc).
   * @returns {QueryBuilder} Returns current instance to be chained
   */
  sortBy (field, direction) {
    this.query = this.query.simplesort(field, { desc: direction === 'desc' })
    return this
  }

  /**
   * Filter results
   * @param {object} query - Where query.
   * @returns {QueryBuilder} Returns current instance to be chained
   */
  where (query) {
    this.query = this.query.find(query)
    return this
  }

  /**
   * Search results
   * @param {(Object|string)} query - Search query object or field or search value.
   * @param {string} value - Value of search (means query equals to field).
   * @returns {QueryBuilder} Returns current instance to be chained
   */
  search (query, value) {
    let $fts

    if (typeof query === 'object') {
      $fts = query
    } else if (value) {
      $fts = {
        query: {
          type: 'match',
          field: query,
          value,
          prefix_length: 1,
          fuzziness: 1,
          extended: true,
          minimum_should_match: 1
        }
      }
    } else {
      $fts = {
        query: {
          type: 'bool',
          should: this.options.fullTextSearchFields.map(field => ({
            type: 'match',
            field,
            value: query,
            prefix_length: 1,
            operator: 'and',
            minimum_should_match: 1,
            fuzziness: 1,
            extended: true
          }))
        }
      }
    }

    this.query = this.query.find({ $fts })
    return this
  }

  /**
   * Surround results
   * @param {string} slug - Slug of the file to surround.
   * @param {Object} options - Options to surround (before / after).
   * @returns {QueryBuilder} Returns current instance to be chained
   */
  surround (slug, { before = 1, after = 1 } = {}) {
    // Add slug to keys if only method has been called before
    if (this.keys) {
      this.keys.push('slug')
    }

    const fn = (data) => {
      const index = data.findIndex(item => item.slug === slug)
      const slice = new Array(before + after).fill(null, 0)
      if (index === -1) {
        return slice
      }

      const prevSlice = data.slice(index - before, index)
      const nextSlice = data.slice(index + 1, index + 1 + after)

      let prevIndex = 0
      for (let i = before - 1; i >= 0; i--) {
        slice[i] = prevSlice[prevIndex] || null
        prevIndex++
      }

      let nextIndex = 0
      for (let i = before; i <= after; i++) {
        slice[i] = nextSlice[nextIndex] || null
        nextIndex++
      }

      return slice
    }

    this.postprocess.push(fn)
    return this
  }

  /**
   * Limit number of results
   * @param {number} n - Limit number.
   * @returns {QueryBuilder} Returns current instance to be chained
   */
  limit (n) {
    if (typeof n === 'string') { n = parseInt(n) }

    this.query = this.query.limit(n)
    return this
  }

  /**
   * Skip number of results
   * @param {number} n - Skip number.
   * @returns {QueryBuilder} Returns current instance to be chained
   */
  skip (n) {
    if (typeof n === 'string') { n = parseInt(n) }

    this.query = this.query.offset(n)
    return this
  }

  /**
   * Collect data and apply process filters
   * @returns {(Object|Array)} Returns processed data
   */
  // eslint-disable-next-line require-await
  async fetch () {
    // Collect data without meta fields
    let data = this.query.data({ removeMeta: true })
    // Handle only keys
    if (this.keys) {
      // Map data and returns object picked by keys
      const fn = data => data.map(item => pick(item, this.keys))
      // Apply pick during postprocess
      this.postprocess.unshift(fn)
    }
    // Apply postprocess fns to data
    for (const fn of this.postprocess) {
      data = fn(data)
    }

    if (!data) {
      throw new Error(`${this.path} not found`)
    }

    return data
  }
}

module.exports = QueryBuilder
