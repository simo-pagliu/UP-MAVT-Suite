#!/usr/bin/env python
"""CLI tool to reset the admin password stored in MongoDB.

Run this script whenever you need to regain access to the admin panel.  It
generates a new random password, hashes it, persists the hash in the database,
and prints the plain-text password to the terminal.

Usage::

    python reset_admin_password.py

The ``MONGO_URI`` environment variable controls which database is targeted
(defaults to ``mongodb://localhost:27017/elicitation``).  The value must point
to the same database used by the running application.
"""

import os
import secrets
import sys

from pymongo import MongoClient
from werkzeug.security import generate_password_hash


def reset_password(mongo_uri: str = None) -> str:
    """Reset the admin password in the database and return the new plain-text password.

    Args:
        mongo_uri: Optional MongoDB connection URI.  Defaults to the
            ``MONGO_URI`` environment variable or
            ``mongodb://localhost:27017/elicitation``.

    Returns:
        The new plain-text password that was stored (as a hash) in the DB.
    """
    if mongo_uri is None:
        mongo_uri = os.getenv('MONGO_URI', 'mongodb://localhost:27017/elicitation')

    client = MongoClient(mongo_uri)
    db = client.get_default_database()

    new_password = secrets.token_urlsafe(16)
    password_hash = generate_password_hash(new_password)

    db.users.update_one(
        {'role': 'admin'},
        {'$set': {'password_hash': password_hash}},
        upsert=True,
    )

    client.close()
    return new_password


def main():
    """Entry point for the CLI tool."""
    new_password = reset_password()
    print('Admin password has been reset successfully.')
    print(f'New password: {new_password}')
    print('Store this password in a safe place — it will not be shown again.')


if __name__ == '__main__':
    main()
