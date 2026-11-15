import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageIdentity} from '../shared/image-identity.mjs';
test('rotating signatures preserve identity without mixing different assets',()=>{
 const base='https://example.supabase.co/storage/v1/object/sign/qmx-assets/';
 assert.equal(imageIdentity(base+'a.png?token=old'),imageIdentity(base+'a.png?token=new'));
 assert.notEqual(imageIdentity(base+'a.png?token=new'),imageIdentity(base+'b.png?token=new'));
 assert.notEqual(imageIdentity(base+'a.png'),imageIdentity(base.replace('example.','other.')+'a.png'));
 assert.notEqual(imageIdentity('https://example.com/a?v=1'),imageIdentity('https://example.com/a?v=2'));
 assert.equal(imageIdentity('blob:example'),'blob:example');
});
