"""units, new roles, elective groups

Revision ID: 0011
Revises: 0010
"""
from alembic import op
import sqlalchemy as sa


revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def _stamps():
    return [
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    ]


def upgrade() -> None:
    op.execute("ALTER TYPE role ADD VALUE IF NOT EXISTS 'vice_principal'")
    op.execute("ALTER TYPE role ADD VALUE IF NOT EXISTS 'it_admin'")
    op.create_table(
        'units',
        sa.Column('school_id', sa.Uuid(), sa.ForeignKey('schools.id', ondelete='CASCADE'), nullable=False),
        sa.Column('department_id', sa.Uuid(), sa.ForeignKey('departments.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('teaching', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('description', sa.String(500), nullable=True),
        sa.Column('head_user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        *_stamps(),
        sa.UniqueConstraint('department_id', 'name', name='uq_unit_name'),
    )
    op.create_index('ix_units_school_id', 'units', ['school_id'])
    op.create_index('ix_units_department_id', 'units', ['department_id'])
    op.add_column('subjects', sa.Column('unit_id', sa.Uuid(), sa.ForeignKey('units.id', ondelete='SET NULL'), nullable=True))
    op.add_column('staff_profiles', sa.Column('unit_id', sa.Uuid(), sa.ForeignKey('units.id', ondelete='SET NULL'), nullable=True))
    op.create_table(
        'teaching_groups',
        sa.Column('branch_id', sa.Uuid(), sa.ForeignKey('branches.id', ondelete='CASCADE'), nullable=False),
        sa.Column('level', sa.String(30), nullable=False),
        sa.Column('subject_id', sa.Uuid(), sa.ForeignKey('subjects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('teacher_user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('capacity', sa.Integer(), nullable=True),
        *_stamps(),
    )
    op.create_index('ix_teaching_groups_branch_id', 'teaching_groups', ['branch_id'])
    op.create_index('ix_teaching_groups_subject_id', 'teaching_groups', ['subject_id'])
    op.create_index('ix_teaching_groups_teacher_user_id', 'teaching_groups', ['teacher_user_id'])
    op.create_table(
        'student_electives',
        sa.Column('student_id', sa.Uuid(), sa.ForeignKey('students.id', ondelete='CASCADE'), nullable=False),
        sa.Column('subject_id', sa.Uuid(), sa.ForeignKey('subjects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('group_id', sa.Uuid(), sa.ForeignKey('teaching_groups.id', ondelete='SET NULL'), nullable=True),
        *_stamps(),
        sa.UniqueConstraint('student_id', 'subject_id', name='uq_student_elective'),
    )
    op.create_index('ix_student_electives_student_id', 'student_electives', ['student_id'])
    op.create_index('ix_student_electives_subject_id', 'student_electives', ['subject_id'])
    op.create_index('ix_student_electives_group_id', 'student_electives', ['group_id'])


def downgrade() -> None:
    op.drop_table('student_electives')
    op.drop_table('teaching_groups')
    op.drop_column('staff_profiles', 'unit_id')
    op.drop_column('subjects', 'unit_id')
    op.drop_table('units')
