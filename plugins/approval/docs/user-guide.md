---
title: "Request and decide an approval"
description: "Your administrator must configure approval rules and grant access. Confirm the target's label, revision and content. Saving a request does not execute the underlying business operation."
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# Request and decide an approval

## Prerequisites

Your administrator must configure approval rules and grant access. Confirm the target's label, revision and content. Saving a request does not execute the underlying business operation.

## Step-by-Step Implementation

1. Choose the approval rule, title, target type and target ID with the request action.
2. Review the request's current state and decision history.
3. Assigned approvers record approval/rejection and a reason in sequence. Requesters cannot impersonate another approver; independent review rules forbid approving your own request.
4. The requester may withdraw a pending request. Reload after a conflict or permission change.

## Verification

Reload and confirm pending, approved, rejected or withdrawn status and the recorded decision. Do not treat the approval screen as evidence that spending, publication or a contract was executed.

## Troubleshooting / Common Pitfalls

If another person decides first, reload the latest revision. Ask an administrator about missing permission, assignment or host connectivity. Never approve a different target merely because its title looks similar.

Developers configuring this screen should use the [host integration guide](maintainer-guide.md) for package imports and host requirements.
