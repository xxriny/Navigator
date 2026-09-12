"""Single-process, in-memory review proposals. IDs are handles, never permission.

Unapproved content is not persisted. Restart invalidates every outstanding handle.
The caller must reauthorize the actor and target on every operation, including retries.
"""
from copy import deepcopy
from threading import RLock
from time import time
from uuid import uuid4


class ProposalError(ValueError):
    pass


class ProposalStore:
    def __init__(self, ttl=900, clock=time, capacity=1000):
        self.ttl, self.clock, self.capacity = ttl, clock, capacity
        self._entries = {}
        self._lock = RLock()

    def issue(self, actor_id, session_id, team_id, kind, items):
        if not actor_id or not session_id or not items or len(items) > 100:
            raise ProposalError('Invalid proposal target or batch size')
        with self._lock:
            now = self.clock()
            self._entries = {k: v for k, v in self._entries.items() if v['expires_at'] > now}
            if len(self._entries) >= self.capacity:
                raise ProposalError('Proposal capacity reached; retry later')
            entry = dict(proposal_id=str(uuid4()), actor_id=actor_id, session_id=session_id,
                         team_id=team_id, kind=kind, expires_at=now+self.ttl, state='pending',
                         items=[{'item_id': str(uuid4()), 'content': deepcopy(i)} for i in items])
            self._entries[entry['proposal_id']] = entry
            return deepcopy(entry)

    def _get(self, proposal_id, actor_id):
        entry = self._entries.get(proposal_id)
        if not entry or entry['actor_id'] != actor_id:
            raise ProposalError('Proposal not found for this user')
        if entry['expires_at'] <= self.clock():
            raise ProposalError('Proposal expired; generate and review again')
        return entry

    def read(self, proposal_id, actor_id):
        with self._lock:
            return deepcopy(self._get(proposal_id, actor_id))

    def cancel(self, proposal_id, actor_id):
        with self._lock:
            entry = self._get(proposal_id, actor_id)
            if entry['state'] not in {'pending', 'cancelled'}:
                raise ProposalError('Proposal cannot be cancelled')
            entry['state'] = 'cancelled'
            return {'state': 'cancelled'}

    def execute(self, proposal_id, actor_id, selected_ids, writer):
        with self._lock:
            entry = self._get(proposal_id, actor_id)
            if (not selected_ids or len(selected_ids) != len(set(selected_ids))
                    or not set(selected_ids).issubset({i['item_id'] for i in entry['items']})):
                raise ProposalError('Invalid proposal selection')
            selection = sorted(selected_ids)
            if entry['state'] == 'succeeded' and entry['selection'] == selection:
                return deepcopy(entry['result'])
            if entry['state'] != 'pending':
                raise ProposalError('Proposal is no longer pending; review again')
            entry['state'] = 'executing'
            try:
                result = writer(deepcopy([i['content'] for i in entry['items'] if i['item_id'] in selection]))
            except Exception:
                # Do not retry a write whose outcome may be uncertain. Restart also
                # invalidates the ID, preventing blind replay after a process crash.
                entry['state'] = 'outcome_unknown'
                raise
            entry.update(state='succeeded', selection=selection, result=deepcopy(result))
            return deepcopy(result)


proposal_store = ProposalStore()
