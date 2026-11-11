import unittest
from pathlib import Path

from pydantic import ValidationError

from backend.main import Deadline, Notice


class FrontendContractTests(unittest.TestCase):
    def test_uncertain_dates_never_replace_the_original_wording(self):
        cases = [
            ("by May 3", "Return it by May 3. The trip is in 2027.", "2027-05-03"),
            ("by May 3, 2027", "Return it by May 3.", "2027-05-03"),
            ("within 30 days of May 3, 2027", "Reply within 30 days of May 3, 2027.", "2027-06-02"),
            ("before May 3, 2027", "Reply before May 3, 2027.", "2027-05-03"),
            ("by 05/03/2027", "Reply by 05/03/2027.", "2027-05-03"),
            ("by February 29, 2027", "Reply by February 29, 2027.", "2027-02-29"),
        ]
        for when, quote, proposed_date in cases:
            with self.subTest(when=when):
                item = Deadline(action="Reply", when=when, source_quote=quote, date=proposed_date)
                self.assertIsNone(item.date)
                self.assertEqual(item.when, when)

    def test_fixture_and_translations(self):
        fixture = Path(__file__).resolve().parents[1] / "api" / "sample-response.json"
        response = Notice.model_validate_json(fixture.read_bytes())
        dates = [item.date.isoformat() if item.date else None for item in response.deadlines]
        self.assertCountEqual(dates, ["2027-05-03", None, None])
        fields = response.model_dump()
        fields["translated_checklist"] = []
        with self.assertRaises(ValidationError):
            Notice.model_validate(fields)
