-- migrate:up
alter table team.space_request_receipts add column space_id uuid references team.spaces(id) on delete cascade;
-- Old instances still omit the scope during a rolling deployment.
create function team.scope_space_receipt() returns trigger language plpgsql as $$
begin
  if new.space_id is null then
    select space.id into new.space_id from team.spaces space where
      new.response #>> '{result,space,id}' = space.id::text
      or exists (select 1 from team.members member where member.space_id=space.id and member.id::text = coalesce(
        new.response #>> '{result,member,id}', new.response #>> '{result,memberId}'))
      or exists (select 1 from team.space_invitations invitation where invitation.space_id=space.id
        and invitation.id::text = new.response #>> '{result,invitation,id}');
  end if;
  return new;
end;
$$;
create trigger space_receipt_scope before insert on team.space_request_receipts
  for each row execute function team.scope_space_receipt();
update team.space_request_receipts receipt set space_id = space.id from team.spaces space where
  receipt.response #>> '{result,space,id}' = space.id::text
  or exists (select 1 from team.members member where member.space_id=space.id and member.id::text = coalesce(
    receipt.response #>> '{result,member,id}', receipt.response #>> '{result,memberId}'))
  or exists (select 1 from team.space_invitations invitation where invitation.space_id=space.id
    and invitation.id::text = receipt.response #>> '{result,invitation,id}');
alter table team.space_request_receipts alter column space_id set not null;
create index space_receipts_scope_idx on team.space_request_receipts(space_id);

-- migrate:down
drop trigger space_receipt_scope on team.space_request_receipts;
drop function team.scope_space_receipt();
alter table team.space_request_receipts drop column space_id;
