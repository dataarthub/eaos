import {test} from 'node:test'
import assert from 'node:assert/strict'
import {contrastRatio} from './contrast.mjs'
test('black/white and identical colors have WCAG ratios 21 and 1',()=>{
 assert.equal(contrastRatio([0,0,0,1],[[255,255,255,1]]),21)
 assert.equal(contrastRatio([255,255,255,1],[[255,255,255,1]]),1)
})
test('transparent text and nested translucent backgrounds are composited before contrast',()=>{
 assert.ok(Math.abs(contrastRatio([0,0,0,0.5],[[255,255,255,1]])-3.97665)<0.001)
 assert.equal(contrastRatio([0,0,0,1],[[0,0,0,1],[255,255,255,0.5]]),contrastRatio([0,0,0,1],[[127.5,127.5,127.5,1]]))
})
