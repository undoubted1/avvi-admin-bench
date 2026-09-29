"""Answers the model's READ tools from data/tenant.json.

Only the tools in READ_TOOLS are answered. Every other tool call (writes,
confirmations, and get_bitlocker_keys, which hands out a secret) is recorded
by bench.py and the run stops. Nothing here can change anything.
"""
import json
from pathlib import Path

TENANT = json.loads((Path(__file__).parent / "data" / "tenant.json").read_text(encoding="utf-8"))
DOMAIN = TENANT["company"]["domain"]
SKUS = {s["skuPartNumber"]: s for s in TENANT["licenses"]}


def _email(local):
    return local if "@" in local else f"{local}@{DOMAIN}"


def _norm(s):
    return (s or "").strip().lower()


def _user(ident):
    """Find a user or guest by email, UPN or display name. Returns None if not found."""
    q = _norm(ident)
    if not q:
        return None
    people = TENANT["users"] + TENANT["guests"]
    for u in people:
        if _norm(u["email"]) == q:
            return u
    for u in people:
        if _norm(u["displayName"]) == q or _norm(u["email"]).split("@")[0] == q:
            return u
    return None


def _shared(ident):
    q = _norm(ident)
    for m in TENANT["sharedMailboxes"]:
        if q in (_norm(m["email"]), _norm(m["displayName"]), _norm(m["email"]).split("@")[0]):
            return m
    return None


def _group(ident):
    q = _norm(ident)
    for g in TENANT["groups"]:
        if q in (_norm(g["displayName"]), _norm(g.get("email"))):
            return g
    return None


def _person_summary(u):
    return {
        "displayName": u["displayName"],
        "email": u["email"],
        "userPrincipalName": u["email"],
        "jobTitle": u.get("jobTitle"),
        "department": u.get("department"),
        "accountEnabled": u.get("accountEnabled", True),
        "onPremisesSyncEnabled": u.get("onPremisesSyncEnabled", False),
        "userType": u.get("userType", "Member"),
        **({"note": u["note"]} if u.get("note") else {}),
    }


def _members(g):
    out = []
    for local in g["members"]:
        u = _user(_email(local))
        out.append({"displayName": u["displayName"] if u else local, "email": _email(local)})
    return out


def _not_found(kind, ident):
    return {"success": False, "error": f"{kind} not found: {ident}"}


# ---------------------------------------------------------------- read tools

def search_users(query=""):
    q = _norm(query)
    people = TENANT["users"] + TENANT["guests"]
    if not q:
        hits = people
    else:
        tokens = q.replace(".", " ").split()
        hits = [u for u in people
                if all(t in _norm(u["displayName"]) + " " + _norm(u["email"]) for t in tokens)]
    return {"success": True, "count": len(hits), "users": [_person_summary(u) for u in hits]}


def resolve_email_recipient(emailAddress):
    u = _user(emailAddress)
    if u:
        return {"success": True, "recipientType": "GuestUser" if u.get("userType") == "Guest" else "UserMailbox",
                "displayName": u["displayName"], "email": u["email"],
                **({"note": u["note"]} if u.get("note") else {})}
    m = _shared(emailAddress)
    if m:
        return {"success": True, "recipientType": "SharedMailbox", "displayName": m["displayName"], "email": m["email"]}
    g = _group(emailAddress)
    if g:
        return {"success": True, "recipientType": g["type"], "displayName": g["displayName"], "email": g.get("email")}
    return _not_found("Recipient", emailAddress)


def get_mailbox_details(userId):
    m = _shared(userId)
    if m:
        return {"success": True, "displayName": m["displayName"], "email": m["email"], "isSharedMailbox": True,
                "userPurpose": "shared", "accountEnabled": False}
    u = _user(userId)
    if not u or u.get("userType") == "Guest":
        return _not_found("Mailbox", userId)
    return {"success": True, "displayName": u["displayName"], "email": u["email"], "isSharedMailbox": False,
            "userPurpose": "user", "accountEnabled": u["accountEnabled"],
            "onPremisesSyncEnabled": u["onPremisesSyncEnabled"], "forwarding": None, "autoReplyEnabled": False}


def get_all_mailboxes(mailboxType=None):
    rows = []
    if mailboxType in (None, "", "user"):
        rows += [{"displayName": u["displayName"], "email": u["email"], "accountEnabled": u["accountEnabled"],
                  "isSharedMailbox": False, "userPurpose": "user"} for u in TENANT["users"]]
    if mailboxType in (None, "", "shared"):
        rows += [{"displayName": m["displayName"], "email": m["email"], "accountEnabled": False,
                  "isSharedMailbox": True, "userPurpose": "shared"} for m in TENANT["sharedMailboxes"]]
    return {"success": True, "count": len(rows), "mailboxes": rows}


def get_mailbox_permissions(mailboxEmail):
    m = _shared(mailboxEmail)
    if m:
        return {"success": True, "mailbox": m["email"], "isSharedMailbox": True,
                "fullAccess": m["fullAccess"], "sendAs": m["sendAs"], "sendOnBehalf": []}
    u = _user(mailboxEmail)
    if not u or u.get("userType") == "Guest":
        return _not_found("Mailbox", mailboxEmail)
    d = next((x for x in TENANT["mailboxDelegations"] if _norm(x["mailbox"]) == _norm(u["email"])), None)
    return {"success": True, "mailbox": u["email"], "isSharedMailbox": False,
            "fullAccess": d["fullAccess"] if d else [], "sendAs": d["sendAs"] if d else [],
            "sendOnBehalf": d["sendOnBehalf"] if d else []}


def get_user_delegations(userEmail, forceRefresh=None):
    u = _user(userEmail)
    if not u:
        return _not_found("User", userEmail)
    e = _norm(u["email"])
    rows = []
    for m in TENANT["sharedMailboxes"]:
        perms = [p for p, lst in (("FullAccess", m["fullAccess"]), ("SendAs", m["sendAs"])) if e in map(_norm, lst)]
        if perms:
            rows.append({"mailbox": m["email"], "permissions": perms})
    for d in TENANT["mailboxDelegations"]:
        perms = [p for p, lst in (("FullAccess", d["fullAccess"]), ("SendAs", d["sendAs"]),
                                  ("SendOnBehalf", d["sendOnBehalf"])) if e in map(_norm, lst)]
        if perms:
            rows.append({"mailbox": d["mailbox"], "permissions": perms})
    return {"success": True, "user": u["email"], "checkedAllMailboxes": True, "delegations": rows}


def get_user_group_memberships(userEmail):
    u = _user(userEmail)
    if not u:
        return _not_found("User", userEmail)
    local = _norm(u["email"]).split("@")[0]
    groups = [{"displayName": g["displayName"], "type": g["type"], "email": g.get("email")}
              for g in TENANT["groups"] if local in g["members"]]
    return {"success": True, "user": u["email"], "groups": groups}


def get_all_groups():
    return {"success": True, "groups": [{"displayName": g["displayName"], "type": g["type"], "email": g.get("email"),
                                         "memberCount": len(g["members"])} for g in TENANT["groups"]]}


def get_security_group_members(groupIdentifier):
    g = _group(groupIdentifier)
    if not g:
        return _not_found("Group", groupIdentifier)
    return {"success": True, "group": g["displayName"], "type": g["type"], "members": _members(g)}


def get_distribution_list_members(emailAddress):
    return get_security_group_members(emailAddress)


def get_user_licenses(userEmail):
    u = _user(userEmail)
    if not u or u.get("userType") == "Guest":
        return _not_found("User", userEmail)
    return {"success": True, "user": u["email"],
            "licenses": [{"skuId": SKUS[s]["skuId"], "skuPartNumber": s, "name": SKUS[s]["name"]}
                         for s in u.get("licenses", [])]}


def check_license_availability(skuId=None):
    rows = [s for s in TENANT["licenses"]
            if not skuId or _norm(skuId) in (_norm(s["skuId"]), _norm(s["skuPartNumber"]), _norm(s["name"]))]
    if not rows:
        return _not_found("License", skuId)
    return {"success": True, "licenses": [{**s, "available": s["total"] - s["assigned"]} for s in rows]}


def get_forwarding_status(mailboxEmail):
    if not (_user(mailboxEmail) or _shared(mailboxEmail)):
        return _not_found("Mailbox", mailboxEmail)
    return {"success": True, "mailbox": mailboxEmail, "forwardingEnabled": False, "forwardTo": None}


def get_mfa_status(userEmail):
    u = _user(userEmail)
    if not u or u.get("userType") == "Guest":
        return _not_found("User", userEmail)
    reg = u.get("mfaRegistered", False)
    return {"success": True, "user": u["email"], "mfaRegistered": reg,
            "methods": ["microsoftAuthenticator", "phone"] if reg else []}


def get_sign_in_logs(userEmail, maxResults=None):
    # Not modelled. Say so rather than returning an empty list that reads as "no sign-ins".
    return {"success": False, "error": "Sign-in logs are not available in this bench."}


def list_user_devices(userEmail):
    u = _user(userEmail)
    if not u:
        return _not_found("User", userEmail)
    devs = [{k: d[k] for k in ("deviceId", "deviceName", "type", "compliant", "companyOwned")}
            for d in TENANT["devices"] if _norm(d["owner"]) == _norm(u["email"])]
    return {"success": True, "user": u["email"], "devices": devs}


READ_TOOLS = {
    "search_users": search_users,
    "resolve_email_recipient": resolve_email_recipient,
    "get_mailbox_details": get_mailbox_details,
    "get_all_mailboxes": get_all_mailboxes,
    "get_mailbox_permissions": get_mailbox_permissions,
    "get_user_delegations": get_user_delegations,
    "get_user_group_memberships": get_user_group_memberships,
    "get_all_groups": get_all_groups,
    "get_security_group_members": get_security_group_members,
    "get_distribution_list_members": get_distribution_list_members,
    "get_user_licenses": get_user_licenses,
    "check_license_availability": check_license_availability,
    "get_forwarding_status": get_forwarding_status,
    "get_mfa_status": get_mfa_status,
    "get_sign_in_logs": get_sign_in_logs,
    "list_user_devices": list_user_devices,
}


def answer(name, args):
    """Run a read tool. Bad or unexpected arguments come back as an error, never an exception."""
    fn = READ_TOOLS.get(name)
    if fn is None:
        return {"success": False, "error": "not available in this bench"}
    try:
        return fn(**(args or {}))
    except TypeError as e:
        return {"success": False, "error": f"bad arguments for {name}: {e}"}
