import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATEGORIES, products } from '../src/data/products.js';

// Invariants of the static demo catalog (src/data/products.js).

describe('static product catalog', () => {
  it('has exactly 50 products with ids P001 to P050 in order', () => {
    assert.equal(products.length, 50);
    products.forEach((product, index) => {
      assert.equal(product.id, `P${String(index + 1).padStart(3, '0')}`);
    });
  });

  it('has unique ids, names and image URLs', () => {
    for (const field of ['id', 'name', 'imageUrl']) {
      assert.equal(new Set(products.map((product) => product[field])).size, products.length, field);
    }
  });

  it('uses exactly the eight categories with a balanced mix', () => {
    assert.deepEqual([...CATEGORIES], [
      'Saree',
      'Three Piece',
      'Kurti',
      'Panjabi',
      'T-Shirt',
      'Shirt',
      'Hijab',
      "Women's Dress",
    ]);
    const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
    for (const product of products) {
      assert.ok(product.category in counts, `unknown category ${product.category}`);
      counts[product.category] += 1;
    }
    for (const [name, count] of Object.entries(counts)) {
      assert.ok(count >= 6 && count <= 7, `${name} has ${count} products`);
    }
  });

  it('gives every product the full schema with sensible values', () => {
    for (const product of products) {
      assert.deepEqual(Object.keys(product), [
        'id',
        'name',
        'description',
        'category',
        'price',
        'currency',
        'imageUrl',
        'available',
      ]);
      assert.ok(product.name.trim().length >= 5 && product.name.length <= 60, product.id);
      assert.ok(product.description.length >= 20 && product.description.length <= 80, product.id);
      assert.ok(Number.isInteger(product.price) && product.price >= 200 && product.price <= 10000, product.id);
      assert.equal(product.currency, 'BDT');
      assert.equal(product.available, true);
      assert.ok(Object.isFrozen(product), `${product.id} should be frozen`);
    }
    assert.ok(Object.isFrozen(products));
  });

  it('uses stable public HTTPS image URLs, never random-image endpoints', () => {
    for (const product of products) {
      const url = new URL(product.imageUrl);
      assert.equal(url.protocol, 'https:', product.id);
      assert.ok(!/source\.unsplash|picsum|loremflickr|placeholder|random/i.test(product.imageUrl), product.id);
      assert.ok(product.imageUrl.length < 400, product.id);
    }
  });

  it('shows a mix of categories on the first Messenger page of five cards', () => {
    const firstPage = products.slice(0, 5).map((product) => product.category);
    assert.equal(new Set(firstPage).size, 5);
  });
});
