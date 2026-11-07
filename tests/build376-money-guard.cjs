'use strict';
// Build 376 (owner: a jailbreak tool must not change the money or any number of the game). Between two transactions
// nothing may change a company balance, a holding of shares, the group value or the debt. In the release edition a
// value raised outside a transaction (the debt lowered) — what a memory editor does — is put back at the start of the
// next transaction; what a transaction itself changes stands. The development edition changes nothing (its tests set
// balances directly), and GH_MONEY_GUARD_STRICT turns any difference into an error.
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');

const {s}=harness(['finance-core','transaction-core','save-schema']),TX=s.GH_TRANSACTION_CORE,F=s.GH_FINANCE_CORE;
const fresh=()=>{const state={...minimal(),profile:{name:'Guard'},openedCompanies:['air'],portfolio:{BANK:100},groupValue:5e8,debt:2e7};F.ensure(state);F.book(state,'air').accounts[0].balance=1000000;F.reconcile(state);return state;};
const air=state=>F.book(state,'air').accounts[0].balance;
const run=(state,fn=()=>{})=>TX.execute(state,{label:'guard-test',apply(){fn();return true;}});

// Release: a cheat between transactions is undone, a transaction's own change stands.
s.GH_EDITION='release';
let state=fresh();run(state);
run(state,()=>{F.book(state,'air').accounts[0].balance+=250000;state.debt=2e7;});assert.equal(air(state),1250000,'a transaction changes the balance');
F.book(state,'air').accounts[0].balance=999999999;state.portfolio.BANK=1e9;state.groupValue=9e12;state.debt=0;
run(state);
assert.deepEqual([air(state),state.portfolio.BANK,state.groupValue,state.debt],[1250000,100,5e8,2e7],'the edited money, shares, value and debt are put back');
assert.equal(TX.moneyGuard.telemetry().restored,4);
// Only the cheating direction is put back: a lower balance outside a transaction is left alone.
F.book(state,'air').accounts[0].balance=10;run(state);assert.equal(air(state),10);
// A state replaced as a whole (a load) is the new reference.
const loaded=fresh();loaded.portfolio.BANK=7;TX.restoreObject(state,JSON.parse(JSON.stringify(loaded)));run(state);assert.equal(state.portfolio.BANK,7,'a loaded save is not undone');

// Development: nothing is undone (tests and tools set balances directly).
s.GH_EDITION=undefined;state=fresh();run(state);F.book(state,'air').accounts[0].balance=5;run(state);assert.equal(air(state),5);
// Strict: any difference is an error.
s.GH_MONEY_GUARD_STRICT=true;state=fresh();run(state);F.book(state,'air').accounts[0].balance+=1;
assert.throws(()=>run(state),/money-guard-changed-outside-transaction:b\|air\|0/);
delete s.GH_MONEY_GUARD_STRICT;
console.log('BUILD376_MONEY_GUARD_PASS');
