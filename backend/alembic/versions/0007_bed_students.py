"""a boarder in each bed

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa


revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('beds', sa.Column('student_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('fk_beds_student', 'beds', 'students', ['student_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_beds_student_id', 'beds', ['student_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_beds_student_id', table_name='beds')
    op.drop_constraint('fk_beds_student', 'beds', type_='foreignkey')
    op.drop_column('beds', 'student_id')
