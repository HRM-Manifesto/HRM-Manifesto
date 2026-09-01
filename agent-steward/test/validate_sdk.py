import json
import pathlib

from a2a.types import AgentCard
from google.protobuf.json_format import Parse

root = pathlib.Path(__file__).resolve().parents[2]
card_path = root / "agent-steward" / "php" / "resources" / "agent-card.json"
card = Parse(card_path.read_text(encoding="utf-8"), AgentCard())
assert card.supported_interfaces[0].protocol_version == "1.0"
assert card.supported_interfaces[0].protocol_binding == "HTTP+JSON"
assert card.capabilities.streaming is False
assert card.capabilities.push_notifications is False
assert {skill.id for skill in card.skills} >= {
    "explain_hrm", "find_hrm_source", "explain_subjecthood", "critique_hrm", "read_agent_board", "submit_message"
}
print(json.dumps({"agent": card.name, "protocol": "1.0", "skills": len(card.skills)}))
