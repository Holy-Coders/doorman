import io
import unittest

from prepare import compact_events, json_sessions, sql_values, signal


class ImportTests(unittest.TestCase):
    def test_sql_is_parsed_as_data_including_escaped_delimiters(self):
        self.assertEqual(sql_values("(1, 'a,b', 'can\\'t', 'line\\nnext', NULL, -2);"),
                         [1, 'a,b', "can't", 'line\nnext', None, -2])
        self.assertIsNone(sql_values('DROP TABLE visitors;'))
        with self.assertRaises(ValueError):
            sql_values("(1, 'x'); DROP TABLE visitors;")
        with self.assertRaises(ValueError):
            sql_values("(1, untrusted_function());")

    def test_stream_reader_handles_chunk_boundaries_and_truncation(self):
        class Tiny(io.StringIO):
            def read(self, size=-1):
                return super().read(min(size, 3) if size>=0 else 3)
        self.assertEqual(list(json_sessions(Tiny('{"a":[{"x":"abc"},{"y":2}],"b":[]}'))),
                         [('a', {'x':'abc'}), ('a', {'y':2})])
        with self.assertRaises(ValueError):
            list(json_sessions(Tiny('{"a":[{"x":')))
        with self.assertRaises(ValueError):
            list(json_sessions(Tiny('{"a":[]}garbage')))

    def test_event_projection_discards_content_and_absolute_positions(self):
        events = list(compact_events([
            ['mm','private selector',100,200,10],
            ['mm','private selector',110,180,20],
            ['kd','password','secret key',False,30],
            ['i','password','insertText','secret value',35],
            ['p','password','clipboard secret',40],
            ['md','selector',0,500,900,50],
        ]))
        self.assertEqual(events,[['mousemove',10,0,0],['mousemove',20,10,-20],['keydown',30],['pointerdown',50]])
        self.assertNotIn('secret',str(events))

    def test_document_reload_does_not_create_cross_page_displacement(self):
        events=list(compact_events([['mm',100,200,50],['mm',900,800,2]]))
        self.assertEqual(events,[['mousemove',50,0,0],['reset',2],['mousemove',2,0,0]])

    def test_hidden_or_missing_signal_stays_missing(self):
        for value in [None,'','undefined','No JS','Not supported']:
            self.assertIsNone(signal(value))


if __name__=='__main__':
    unittest.main()
