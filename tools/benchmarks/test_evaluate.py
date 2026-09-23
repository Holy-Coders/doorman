import copy
import unittest

from evaluate import assign_groups, groups, metrics, fit_candidates, evaluate_fold


class EvaluationTests(unittest.TestCase):
    def test_linked_browser_history_cannot_cross_groups(self):
        rows=[dict(group='fp-before',browserLink='cookie'),dict(group='fp-after',browserLink='cookie'),dict(group='fp-after',browserLink='new-cookie'),dict(group='separate')]
        merged=groups(rows)
        self.assertEqual(len(set(merged[:3])),1)
        self.assertNotEqual(merged[0],merged[3])
        split=assign_groups(merged,[.5,.5])
        self.assertEqual(len({split[g] for g in merged[:3]}),1)

    def test_abstentions_stay_in_recall_denominator(self):
        result=metrics([{'positive':True},{'positive':True},{'positive':False}], [1,None,0], [0,1,2],.5)
        self.assertEqual(result['recall'],.5)
        self.assertEqual(result['scored'],2)
        self.assertEqual(result['falsePositiveRate'],0)

    def test_unseen_labels_and_features_cannot_change_fitted_parameters(self):
        rows=[{'positive':bool(i%2),'features':{'mouse_speed':100+1000*(i%2)+(i%7), 'interaction_cv':.1+(i%2)+(i%5)*.01}} for i in range(120)]
        args=(list(range(60)),list(range(60,90)),['mouse_speed','interaction_cv'])
        before,_=fit_candidates(rows,*args)
        altered=copy.deepcopy(rows)
        for row in altered[90:]:
            row['positive']=not row['positive']
            row['features']={'mouse_speed':1e9,'interaction_cv':1e9}
        after,_=fit_candidates(altered,*args)
        self.assertEqual(before,after)

    def test_test_labels_cannot_select_model_or_threshold(self):
        rows=[{'positive':bool(i%2),'features':{'mouse_speed':100+1000*(i%2)+(i%7), 'interaction_cv':.1+(i%2)+(i%5)*.01}} for i in range(150)]
        indices=[list(range(60)),list(range(60,90)),list(range(90,120)),list(range(120,150))]
        before,_=evaluate_fold(rows,indices,{'heldoutAgent':'fixture'})
        altered=copy.deepcopy(rows)
        for row in altered[120:]:
            row['positive']=not row['positive']
        after,_=evaluate_fold(altered,indices,{'heldoutAgent':'fixture'})
        self.assertEqual(before['status'],'evaluated')
        for field in ['selected','threshold','columns','validationComparison']:
            self.assertEqual(before[field],after[field])
        self.assertNotEqual(before['test'],after['test'])


if __name__=='__main__':
    unittest.main()
