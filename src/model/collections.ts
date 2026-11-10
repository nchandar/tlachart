// Small generic helpers over maps and index arrays.

/** A missing key means two maps that should agree do not, so fail loudly. */
export const getOrThrow = <K, V>(map: ReadonlyMap<K, V>, key: K): V => {
	const value = map.get(key);
	if (value === undefined) throw new Error(`The chart lost track of ${JSON.stringify(key)}.`);
	return value;
};

/** Multimap push; creates the list on first use. */
export const addToGroup = <K, V>(groups: Map<K, V[]>, key: K, item: V) => {
	const group = groups.get(key);
	if (group) group.push(item);
	else groups.set(key, [item]);
};

/** 0..n-1, the starting order for sortByKeys. */
export const indices = (n: number) => {
	const items = new Int32Array(n);
	for (let i = 0; i < n; i++) items[i] = i;
	return items;
};

/**
 * Stable counting sort, one pass per key from last to first; typed arrays keep it fast on big
 * graphs.
 */
export const sortByKeys = (items: Int32Array, keys: Int32Array[]) => {
	for (let k = keys.length - 1; k >= 0; k--) {
		const key = keys[k];
		let size = 0;
		for (let p = 0; p < items.length; p++) if (key[items[p]] >= size) size = key[items[p]] + 1;
		const start = new Int32Array(size + 1);
		for (let p = 0; p < items.length; p++) start[key[items[p]] + 1]++;
		for (let v = 0; v < size; v++) start[v + 1] += start[v];
		const sorted = new Int32Array(items.length);
		for (let p = 0; p < items.length; p++) sorted[start[key[items[p]]]++] = items[p];
		items = sorted;
	}
	return items;
};

/** A cache that empties when full, so memory stays bounded. */
export const memo = <K, V>(make: (k: K) => V, limit = 1 << 16) => {
	const cache = new Map<K, V>();
	return (k: K) => {
		let v = cache.get(k);
		if (v === undefined) {
			if (cache.size >= limit) cache.clear();
			cache.set(k, (v = make(k)));
		}
		return v;
	};
};
