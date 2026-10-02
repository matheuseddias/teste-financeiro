import { expect, it } from 'vitest';
import { learnedCandidates, matchesRule, type ClassificationRule } from './learning';
import type { BankTransaction } from './statements';
const t: BankTransaction = { id:'1',tenant_id:'group',account_id:'account',posted_date:'2026-09-01',amount_cents:100,description:' Repasse  CANAL ',external_id:null,source_key:'1',fingerprint:'x',classification:'repasse',category:null,channel:'Canal',version:1,deleted_at:null };
const examples = [t,{...t,id:'2',posted_date:'2026-09-02'},{...t,id:'3',posted_date:'2026-09-03'}];
const rule: ClassificationRule = { id:'rule',tenant_id:'group',account_id:'account',description_key:'repasse canal',direction:1,classification:'repasse',category:null,channel:'Canal',example_ids:['1','2','3'],active:true,version:1,deleted_at:null };
it('sugere somente repetição manual consistente e não aprende sua própria automação', () => {
 expect(learnedCandidates(examples,[])).toHaveLength(1);
 expect(learnedCandidates(examples.slice(0,2),[])).toHaveLength(0);
 expect(learnedCandidates(examples.map(t=>({...t,rule_id:'rule'})),[])).toHaveLength(0);
 expect(learnedCandidates([...examples,{...t,id:'4',channel:'Outro'}],[])).toHaveLength(0);
 expect(learnedCandidates(examples.map(t=>({...t,posted_date:'2026-09-01'})),[])).toHaveLength(0);
 expect(learnedCandidates(examples,[rule])).toHaveLength(0);
});
it('regra não atravessa conta, grupo, sinal ou descrição, nem atua desativada', () => {
 expect(matchesRule(t,rule)).toBe(true);
 for(const changed of [{account_id:'other'},{tenant_id:'other'},{amount_cents:-100},{description:'Repasse canal extra'}])expect(matchesRule({...t,...changed},rule)).toBe(false);
 expect(matchesRule(t,{...rule,active:false})).toBe(false);
});
