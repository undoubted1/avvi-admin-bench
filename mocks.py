"""Answers the model's READ tools from data/tenant.json. Nothing here touches a real tenant."""

import json
from pathlib import Path

TENANT = json.loads((Path(__file__).parent / "data" / "tenant.json").read_text())
DOMAIN = TENANT["company"]["domain"]

READ_PREFIXES = ("search_", "get_", "list_", "check_", "resolve_")
NOT_AVAILABLE = {"success": False, "error": "not available in this bench"}


def is_read_tool(name):
    return name.startswith(READ_PREFIXES)


def _norm(email):
    email = (email or "").strip().lower()
    if email and "@" not in email:
        email = f"{email}@{DOMAIN}"
    return email


def _user(email):
    email = _norm(email)
    for u in TENANT["users"]:
        if u["email"].lower() == email:
            return u
    return None


def _not_found(what):
    return {"success": False, "error": f"{what} not found"}


def _groups_for(email):
    local = _norm(email).split("@")[0]
    return [
        {"displayName": g["displayName"], "email": g["email"], "type": g["type"]}
        for g in TENANT["groups"]
        if local in g["members"]
    ]


def _members(group):
    return [f"{m}@{DOMAIN}" for m in group["members"]]


def search_users(query=""):
    q = (query or "").strip().lower()
    people = TENANT["users"] + TENANT["guests"]
    if not q:
        hits = people
    else:
        words = q.split()
        hits = [
            p for p in people
            if all(w in p["displayName"].lower() or w in p["email"].lower() for w in words)
        ]
    return {"success": True, "count": len(hits), "users": hits}


def resolve_email_recipient(emailAddress):
    email = _norm(emailAddress)
    if _user(email):
        return {"success": True, "type": "user", "recipient": _user(email)}
    for m in TENANT["sharedMailboxes"]:
        if m["email"].lower() == email:
            return {"success": True, "type": "shared mailbox", "recipient": m}
    for g in TENANT["groups"]:
        if (g["email"] or "").lower() == email:
            return {"success": True, "type": g["type"], "recipient": g}
    for g in TENANT["guests"]:
        if g["email"].lower() == email:
            return {"success": True, "type": "guest", "recipient": g}
    return _not_found("recipient")


def get_mailbox_details(userId):
    email = _norm(userId)
    u = _user(email)
    if u:
        return {"success": True, "mailboxType": "user", "displayName": u["displayName"], "email": u["email"],
                "accountEnabled": u["accountEnabled"]}
    for m in TENANT["sharedMailboxes"]:
        if m["email"].lower() == email:
            return {"success": True, "mailboxType": "shared", **m}
    return _not_found("mailbox")


def get_all_mailboxes(mailboxType=None):
    users = [{"displayName": u["displayName"], "email": u["email"], "type": "user"} for u in TENANT["users"]]
    shared = [{"displayName": m["displayName"], "email": m["email"], "type": "shared"} for m in TENANT["sharedMailboxes"]]
    if mailboxType == "shared":
        return {"success": True, "mailboxes": shared}
    if mailboxType == "user":
        return {"success": True, "mailboxes": users}
    return {"success": True, "mailboxes": users + shared}


def get_mailbox_permissions(mailboxEmail):
    email = _norm(mailboxEmail)
    for m in TENANT["sharedMailboxes"]:
        if m["email"].lower() == email:
            return {"success": True, "mailbox": email, "fullAccess": m["fullAccess"], "sendAs": m["sendAs"],
                    "sendOnBehalf": m.get("sendOnBehalf", [])}
    for d in TENANT["mailboxDelegations"]:
        if d["mailbox"].lower() == email:
            return {"success": True, **d}
    if _user(email):
        return {"success": True, "mailbox": email, "fullAccess": [], "sendAs": [], "sendOnBehalf": []}
    return _not_found("mailbox")


def get_user_delegations(userEmail, forceRefresh=False):
    email = _norm(userEmail)
    if not _user(email):
        return _not_found("user")
    out = []
    for m in TENANT["sharedMailboxes"] + [
        {"email": d["mailbox"], "fullAccess": d["fullAccess"], "sendAs": d["sendAs"],
         "sendOnBehalf": d["sendOnBehalf"]} for d in TENANT["mailboxDelegations"]
    ]:
        rights = [r for r in ("fullAccess", "sendAs", "sendOnBehalf") if email in [x.lower() for x in m.get(r, [])]]
        if rights:
            out.append({"mailbox": m["email"], "rights": rights})
    return {"success": True, "userEmail": email, "delegations": out}


def get_user_group_memberships(userEmail):
    if not _user(userEmail):
        return _not_found("user")
    return {"success": True, "userEmail": _norm(userEmail), "groups": _groups_for(userEmail)}


def get_all_groups():
    return {"success": True, "groups": [
        {"displayName": g["displayName"], "email": g["email"], "type": g["type"], "memberCount": len(g["members"])}
        for g in TENANT["groups"]
    ]}


def get_security_group_members(groupIdentifier):
    name = (groupIdentifier or "").strip().lower()
    for g in TENANT["groups"]:
        if g["type"] == "Security group" and g["displayName"].lower() == name:
            return {"success": True, "group": g["displayName"], "members": _members(g)}
    return _not_found("security group")


def get_distribution_list_members(emailAddress):
    email = _norm(emailAddress)
    for g in TENANT["groups"]:
        if (g["email"] or "").lower() == email:
            return {"success": True, "group": g["displayName"], "members": _members(g)}
    return _not_found("distribution list")


def get_user_licenses(userEmail):
    u = _user(userEmail)
    if not u:
        return _not_found("user")
    skus = {l["skuPartNumber"]: l for l in TENANT["licenses"]}
    return {"success": True, "userEmail": u["email"], "licenses": [
        {"skuId": skus[s]["skuId"], "skuPartNumber": s, "name": skus[s]["name"]} for s in u["licenses"] if s in skus
    ]}


def check_license_availability(skuId):
    for l in TENANT["licenses"]:
        if skuId in (l["skuId"], l["skuPartNumber"]):
            return {"success": True, **l, "available": l["total"] - l["assigned"]}
    return {"success": True, "licenses": [
        {**l, "available": l["total"] - l["assigned"]} for l in TENANT["licenses"]
    ], "note": "skuId not recognised; showing all licenses"}


def get_forwarding_status(mailboxEmail):
    email = _norm(mailboxEmail)
    for f in TENANT["forwarding"]:
        if f.get("mailbox", "").lower() == email:
            return {"success": True, **f}
    return {"success": True, "mailbox": email, "forwardingEnabled": False}


def get_mfa_status(userEmail):
    u = _user(userEmail)
    if not u:
        return _not_found("user")
    return {"success": True, "userEmail": u["email"], "mfaRegistered": u["mfaRegistered"]}


def get_sign_in_logs(userEmail, maxResults=10):
    email = _norm(userEmail)
    if not _user(email):
        return _not_found("user")
    logs = [s for s in TENANT["signIns"] if s.get("userEmail", "").lower() == email]
    return {"success": True, "userEmail": email, "signIns": logs[: int(maxResults or 10)]}


def list_user_devices(userEmail):
    email = _norm(userEmail)
    if not _user(email):
        return _not_found("user")
    return {"success": True, "userEmail": email,
            "devices": [d for d in TENANT["devices"] if d["owner"].lower() == email]}


def get_bitlocker_keys(deviceId):
    key = (deviceId or "").strip().lower()
    for d in TENANT["devices"]:
        if key in (d["deviceId"].lower(), d["deviceName"].lower()):
            if "Windows" not in d["type"]:
                return {"success": False, "error": "no BitLocker keys for this device type"}
            return {"success": True, "deviceName": d["deviceName"],
                    "recoveryKeys": [{"keyId": "FAKE-BENCH-KEY", "key": "000000-000000-000000-000000-000000-000000-000000-000000"}]}
    return _not_found("device")


def answer(name, args):
    """Return the mock result for a read tool call."""
    fn = globals().get(name)
    if not is_read_tool(name) or not callable(fn):
        return NOT_AVAILABLE
    try:
        return fn(**(args or {}))
    except TypeError:
        return {"success": False, "error": "invalid arguments"}
