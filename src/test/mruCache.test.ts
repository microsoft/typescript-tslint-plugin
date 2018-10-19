import { expect } from 'chai';
import 'mocha';
import { MruCache } from '../mruCache';

describe('MruCache', () => {
    it('should remove old entries', () => {
        const size = 10;
        const cache = new MruCache<number>(size);

        expect(cache.has('0')).to.equal(false);
        cache.set('0', 0);

        expect(cache.get('0')).to.equal(0);

        for (let i = 1; i < size + 1; ++i) {
            cache.set(i.toString(), i);
        }

        expect(cache.has('0')).to.equal(false);
    });
});

