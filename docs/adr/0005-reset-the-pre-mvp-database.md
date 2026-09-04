# Reset the pre-MVP database

The first team MVP starts from a new schema and an empty database. The current prototype contains no valuable data, so Dig will not build a one-time migration for its fixed actor, free-text assignees, Priority field, or single Board. Once the MVP stores real team data, all later schema changes use the normal checksummed migration path.
