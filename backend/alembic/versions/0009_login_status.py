"""login status: last login and must change password

Revision ID: 0009
Revises: 0008
"""
from alembic import op
import sqlalchemy as sa


revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('must_change_password', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('users', sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'last_login_at')
    op.drop_column('users', 'must_change_password')
