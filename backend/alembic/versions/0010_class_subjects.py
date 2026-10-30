"""subjects each class takes, and their teachers

Revision ID: 0010
Revises: 0009
"""
from alembic import op
import sqlalchemy as sa


revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'class_subjects',
        sa.Column('class_id', sa.Uuid(), nullable=False),
        sa.Column('subject_id', sa.Uuid(), nullable=False),
        sa.Column('teacher_user_id', sa.Uuid(), nullable=True),
        sa.Column('compulsory', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['class_id'], ['classes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['teacher_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('class_id', 'subject_id', name='uq_class_subject'),
    )
    op.create_index('ix_class_subjects_class_id', 'class_subjects', ['class_id'])
    op.create_index('ix_class_subjects_subject_id', 'class_subjects', ['subject_id'])
    op.create_index('ix_class_subjects_teacher_user_id', 'class_subjects', ['teacher_user_id'])


def downgrade() -> None:
    op.drop_table('class_subjects')
