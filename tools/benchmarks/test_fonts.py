import unittest
from fonts import collision_rate, font_set


class FontAuditTests(unittest.TestCase):
    def test_missing_and_empty_remain_distinct(self):
        self.assertIsNone(font_set({'error': 'unavailable'}))
        self.assertIsNone(font_set({'value': [None]}))
        self.assertEqual(font_set({'value': []}), ())
        self.assertEqual(font_set({'value': ['B', 'A', 'A']}), ('A', 'B'))

    def test_collision_counts_ordered_distinct_session_pairs(self):
        self.assertIsNone(collision_rate([1]))
        self.assertEqual(collision_rate([1, 1]), 0)
        self.assertEqual(collision_rate([5]), 1)
        self.assertAlmostEqual(collision_rate([2, 1]), 1 / 3)
