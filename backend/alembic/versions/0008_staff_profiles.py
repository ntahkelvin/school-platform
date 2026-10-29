"""staff profiles and support staff

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE role ADD VALUE IF NOT EXISTS 'support'")
    employment = postgresql.ENUM('full_time', 'part_time', 'contract', 'nysc', 'volunteer', name='employment_type')
    employment.create(op.get_bind(), checkfirst=True)
    op.create_table(
        'staff_profiles',
        sa.Column('school_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('staff_no', sa.String(length=40), nullable=True),
        sa.Column('title', sa.String(length=30), nullable=True),
        sa.Column('gender', postgresql.ENUM('male', 'female', name='gender', create_type=False), nullable=True),
        sa.Column('job_title', sa.String(length=100), nullable=True),
        sa.Column('department_id', sa.Uuid(), nullable=True),
        sa.Column('teaching', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('employment_type', postgresql.ENUM(name='employment_type', create_type=False), nullable=False, server_default='full_time'),
        sa.Column('date_joined', sa.Date(), nullable=True),
        sa.Column('qualification', sa.String(length=100), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['school_id'], ['schools.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('school_id', 'user_id', name='uq_staff_profile_school_user'),
    )
    op.create_index('ix_staff_profiles_school_id', 'staff_profiles', ['school_id'])
    op.create_index('ix_staff_profiles_user_id', 'staff_profiles', ['user_id'])


def downgrade() -> None:
    op.drop_table('staff_profiles')
    op.execute("DROP TYPE IF EXISTS employment_type")
