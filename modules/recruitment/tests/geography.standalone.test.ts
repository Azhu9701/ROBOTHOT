import assert from 'node:assert/strict';
import {test} from 'node:test';
import {placesOf,observationStatus} from '../backend/geography.ts';
test('location countries come from source or exact place evidence, never employer origin',()=>{
  assert.equal(placesOf({location:'Remote'})[0].country,null);
  assert.equal(placesOf({location:'Moss',locations:[{raw:'Moss',country:'Norway',region:'Østfold'}]})[0].country,'NO');
  assert.deepEqual(placesOf({location:'Hybrid- Pittsburgh, PA or Salem, OR'}).map(p=>p.region),['Oregon','Pennsylvania']);
  assert.equal(placesOf({location:'杭州市 | 技术类'})[0].country,'CN');
  assert.equal(placesOf({location:'Austin, Texas, United States'})[0].region,'Texas');
  assert.equal(placesOf({location:'Paris'})[0].country,null);
  assert.equal(placesOf({location:'Chinatown'})[0].country,null);
});
test('expiry, stale and missing do not count as recently observed, at one shared clock',()=>{
  const now=Date.parse('2026-10-27T12:00:00Z');
  const job={last_seen:'2026-10-27T10:00:00Z',details:{}};
  assert.equal(observationStatus(job,now),'observed');
  assert.equal(observationStatus({...job,last_seen:'2026-10-19T10:00:00Z'},now),'stale');
  assert.equal(observationStatus({...job,missing_since:'2026-10-26T00:00:00Z'},now),'unconfirmed');
  assert.equal(observationStatus({...job,details:{validThrough:'2026-10-26T12:00:00Z'}},now),'expired');
  assert.equal(observationStatus({...job,details:{validThrough:'2026-10-27'}},now),'observed');
});
